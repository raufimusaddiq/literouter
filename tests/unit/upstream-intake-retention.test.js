import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Real git fixtures: a host repo whose `origin` is upstream and whose
// `origin-literouter` is the target, plus intake-style clones in a work root.
// Nothing here runs the intake script; only the retention functions are sourced.
const LIB = path.resolve(import.meta.dirname, "../../scripts/upstream-intake-retention.sh");
const GIT_ENV = {
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
};

let root, host, work, bin, upstreamSha, baseSha;

const sh = (cmd, opts = {}) => execFileSync("bash", ["-c", cmd], {
  encoding: "utf8", cwd: opts.cwd, env: { ...process.env, ...GIT_ENV, ...opts.env },
}).trim();
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } }).trim();

function lib(script, env = {}) {
  return sh(`set -euo pipefail; log() { echo "$*"; }; . "${LIB}"; ${script}`, {
    env: {
      PATH: `${bin}:${process.env.PATH}`, REPO: host, REMOTE: "origin", TARGET: "origin-literouter",
      BASE_BRANCH: "main", WORK_ROOT: work, LOG_PREFIX: "t", UPSTREAM_INTAKE_RETAIN_DAYS: "7", ...env,
    },
  });
}

function makeClone(name) {
  const dir = path.join(work, `worktree.${name}`);
  git(root, "clone", "--quiet", "--no-hardlinks", "--no-checkout", host, dir);
  git(dir, "fetch", "--quiet", "--no-tags", host, upstreamSha);
  git(dir, "checkout", "--quiet", "--detach", upstreamSha);
  return dir;
}

const age = (dir, days = 30) => sh(`find "${dir}" -exec touch -h -d "${days} days ago" {} +`);
const classify = (dir, env) => lib(`retention_load_open_prs; if retention_classify "$D" 1; then echo RECLAIM; else echo "KEEP:$RETENTION_REASON"; fi`, { D: dir, ...env });
const commitIn = (dir, file = "work.txt") => {
  fs.writeFileSync(path.join(dir, file), `${Math.random()}`);
  git(dir, "add", file);
  git(dir, "commit", "--quiet", "-m", "agent work");
};

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "intake-ret-")));
  host = path.join(root, "host");
  work = path.join(root, "work");
  bin = path.join(root, "bin");
  fs.mkdirSync(work);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "gh"), "#!/bin/sh\n[ -n \"$FAKE_GH_FAIL\" ] && exit 1\nprintf '%b\\n' \"$FAKE_GH_OPEN\"\n", { mode: 0o755 });
  git(root, "init", "--quiet", "--bare", "upstream.git");
  git(root, "init", "--quiet", "--bare", "target.git");
  git(root, "init", "--quiet", "-b", "main", host);
  fs.writeFileSync(path.join(host, "a.txt"), "a");
  git(host, "add", "a.txt");
  git(host, "commit", "--quiet", "-m", "A");
  baseSha = git(host, "rev-parse", "HEAD");
  git(host, "remote", "add", "origin", path.join(root, "upstream.git"));
  git(host, "remote", "add", "origin-literouter", path.join(root, "target.git"));
  git(host, "push", "--quiet", "origin", "HEAD:refs/heads/master");
  git(host, "push", "--quiet", "origin-literouter", "HEAD:refs/heads/main");
  fs.writeFileSync(path.join(host, "b.txt"), "b");
  git(host, "add", "b.txt");
  git(host, "commit", "--quiet", "-m", "B upstream");
  upstreamSha = git(host, "rev-parse", "HEAD");
  git(host, "push", "--quiet", "origin", "HEAD:refs/heads/master");
  git(host, "reset", "--quiet", "--hard", baseSha);
  git(host, "fetch", "--quiet", "origin", "master");
  git(host, "fetch", "--quiet", "origin-literouter", "main");
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("retention_classify", () => {
  it("reclaims an old clean clone detached at an upstream commit, even with the generated report", () => {
    const dir = makeClone("AAAAAA");
    fs.writeFileSync(path.join(dir, "intake-report.md"), "report");
    age(dir);
    expect(classify(dir)).toBe("RECLAIM");
  });

  it("keeps a clone with recent activity", () => {
    expect(classify(makeClone("AAAAAA"))).toMatch(/^KEEP:active within 7d/);
  });

  it("keeps unpushed local commits on a branch", () => {
    const dir = makeClone("AAAAAA");
    git(dir, "checkout", "--quiet", "-b", "upstream-intake/x");
    commitIn(dir);
    age(dir);
    expect(classify(dir)).toMatch(/^KEEP:branch upstream-intake\/x not on origin-literouter/);
  });

  it("reclaims a published branch with no open PR and keeps it while a PR is open", () => {
    const dir = makeClone("AAAAAA");
    git(dir, "checkout", "--quiet", "-b", "upstream-intake/x");
    commitIn(dir);
    git(dir, "push", "--quiet", path.join(root, "target.git"), "upstream-intake/x");
    age(dir);
    expect(classify(dir)).toBe("RECLAIM");
    expect(classify(dir, { FAKE_GH_OPEN: "upstream-intake/x" })).toBe("KEEP:branch upstream-intake/x has an open PR");
  });

  it("keeps a published branch that gained a local commit afterwards", () => {
    const dir = makeClone("AAAAAA");
    git(dir, "checkout", "--quiet", "-b", "upstream-intake/x");
    commitIn(dir);
    git(dir, "push", "--quiet", path.join(root, "target.git"), "upstream-intake/x");
    commitIn(dir, "later.txt");
    age(dir);
    expect(classify(dir)).toMatch(/^KEEP:branch upstream-intake\/x has commits not on origin-literouter/);
  });

  it("reclaims a branch merged into origin-literouter/main, judged against the target and not origin", () => {
    const dir = makeClone("AAAAAA");
    git(dir, "checkout", "--quiet", "-b", "upstream-intake/y");
    commitIn(dir);
    git(dir, "push", "--quiet", path.join(root, "target.git"), "HEAD:refs/heads/main");
    git(host, "fetch", "--quiet", "origin-literouter", "main");
    age(dir);
    expect(classify(dir)).toBe("RECLAIM");
  });

  it("keeps a detached HEAD at an unrecognized commit", () => {
    const dir = makeClone("AAAAAA");
    commitIn(dir);
    age(dir);
    expect(classify(dir)).toBe("KEEP:detached HEAD at unrecognized commit");
  });

  it("keeps modified, staged, deleted and untracked work even once everything is old", () => {
    const edits = {
      modified: (d) => fs.writeFileSync(path.join(d, "a.txt"), "changed"),
      staged: (d) => { fs.writeFileSync(path.join(d, "a.txt"), "staged"); git(d, "add", "a.txt"); },
      // Worktree restored to HEAD while the index still holds unpublished content.
      stagedOnly: (d) => {
        fs.writeFileSync(path.join(d, "a.txt"), "staged only");
        git(d, "add", "a.txt");
        git(d, "restore", "--source=HEAD", "--worktree", "--", "a.txt");
      },
      stagedNewThenRemoved: (d) => {
        fs.writeFileSync(path.join(d, "new.txt"), "n");
        git(d, "add", "new.txt");
        fs.rmSync(path.join(d, "new.txt"));
      },
      deleted: (d) => fs.rmSync(path.join(d, "a.txt")),
      stagedDelete: (d) => git(d, "rm", "--quiet", "a.txt"),
      untracked: (d) => fs.writeFileSync(path.join(d, "notes.js"), "x"),
      untrackedInDir: (d) => { fs.mkdirSync(path.join(d, "src")); fs.writeFileSync(path.join(d, "src", "new.js"), "x"); },
    };
    let n = 0;
    for (const [name, edit] of Object.entries(edits)) {
      const dir = makeClone(`DIRT${String(n++).padStart(2, "0")}`);
      edit(dir);
      age(dir);
      expect(classify(dir), name).toBe("KEEP:uncommitted or untracked edits");
    }
  });

  it("hashes tracked symlink targets byte for byte, including newlines", () => {
    const makeLinked = (name) => {
      const dir = makeClone(name);
      git(dir, "checkout", "--quiet", "-b", `upstream-intake/${name.toLowerCase()}`);
      fs.symlinkSync("ab", path.join(dir, "link"));
      git(dir, "add", "link");
      git(dir, "commit", "--quiet", "-m", "link");
      git(dir, "push", "--quiet", path.join(root, "target.git"), `upstream-intake/${name.toLowerCase()}`);
      return dir;
    };
    const same = makeLinked("LINKOK");
    age(same);
    expect(classify(same)).toBe("RECLAIM");
    const edited = makeLinked("LINKED");
    fs.rmSync(path.join(edited, "link"));
    fs.symlinkSync("a\nb", path.join(edited, "link"));
    age(edited);
    expect(classify(edited)).toBe("KEEP:uncommitted or untracked edits");
  });

  it("treats a never-checked-out clone as clean only while its work tree is empty", () => {
    const empty = path.join(work, "worktree.EMPTY1");
    git(root, "clone", "--quiet", "--no-hardlinks", "--no-checkout", host, empty);
    age(empty);
    expect(classify(empty)).toBe("RECLAIM");
    const stray = path.join(work, "worktree.EMPTY2");
    git(root, "clone", "--quiet", "--no-hardlinks", "--no-checkout", host, stray);
    fs.writeFileSync(path.join(stray, "agent-notes.md"), "x");
    age(stray);
    expect(classify(stray)).toBe("KEEP:uncommitted or untracked edits");
  });

  it("keeps clones with unknown refs, a missing index, or unreadable git metadata", () => {
    const stash = makeClone("AAAAAA");
    git(stash, "update-ref", "refs/stash", upstreamSha);
    age(stash);
    expect(classify(stash)).toBe("KEEP:unknown ref refs/stash");
    const noIndex = makeClone("BBBBBB");
    fs.rmSync(path.join(noIndex, ".git", "index"));
    age(noIndex);
    expect(classify(noIndex)).toBe("KEEP:uncommitted or untracked edits");
    const broken = makeClone("CCCCCC");
    fs.rmSync(path.join(broken, ".git", "HEAD"));
    age(broken);
    expect(classify(broken)).toMatch(/^KEEP:/);
  });

  it("never executes clone config or hooks while inspecting", () => {
    const dir = makeClone("AAAAAA");
    const marker = path.join(root, "executed");
    git(dir, "config", "core.fsmonitor", `touch ${marker}; echo`);
    git(dir, "config", "core.hooksPath", path.join(dir, "hooks"));
    git(dir, "config", "core.sshCommand", `touch ${marker}`);
    age(dir);
    expect(classify(dir)).toBe("RECLAIM");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("rejects symlinked clones, bad names, and a symlinked .git", () => {
    const real = makeClone("REAL01");
    age(real);
    fs.symlinkSync(real, path.join(work, "worktree.LINK01"));
    expect(classify(path.join(work, "worktree.LINK01"))).toBe("KEEP:unsafe path");
    const badName = path.join(work, "worktree.toolongname");
    fs.cpSync(real, badName, { recursive: true });
    expect(classify(badName)).toBe("KEEP:unsafe path");
    const gitLink = makeClone("GITLNK");
    fs.renameSync(path.join(gitLink, ".git"), path.join(root, "moved.git"));
    fs.symlinkSync(path.join(root, "moved.git"), path.join(gitLink, ".git"));
    expect(classify(gitLink)).toBe("KEEP:unsafe path");
  });
});

describe("retention_gc", () => {
  const exists = (dir) => fs.existsSync(dir);

  it("removes only expired, provably published clones", () => {
    const old = makeClone("OLD001");
    const recent = makeClone("NEW001");
    const unpushed = makeClone("UNP001");
    git(unpushed, "checkout", "--quiet", "-b", "upstream-intake/z");
    commitIn(unpushed);
    age(old);
    age(unpushed);
    lib("retention_gc");
    expect(exists(old)).toBe(false);
    expect(exists(recent)).toBe(true);
    expect(exists(unpushed)).toBe(true);
  });

  it("bounds deletions per run and the scanned candidates", () => {
    const dirs = ["AAAAA1", "AAAAA2", "AAAAA3"].map((n, i) => { const d = makeClone(n); age(d, 30 + i); return d; });
    lib("retention_gc", { UPSTREAM_INTAKE_GC_DELETE_MAX: "1" });
    expect(dirs.filter(exists)).toHaveLength(2);
    lib("retention_gc", { UPSTREAM_INTAKE_GC_SCAN_MAX: "1", UPSTREAM_INTAKE_GC_DELETE_MAX: "5" });
    expect(dirs.filter(exists)).toHaveLength(1);
  });

  it("skips the active run's clone and anything outside direct worktree.* children", () => {
    const active = makeClone("ACTIVE");
    age(active);
    const nested = path.join(work, "keep", "worktree.NESTED");
    fs.mkdirSync(path.dirname(nested));
    fs.cpSync(makeClone("TMPCPY"), nested, { recursive: true });
    age(nested);
    lib("retention_gc", { WORKTREE: active });
    expect(exists(active)).toBe(true);
    expect(exists(nested)).toBe(true);
  });

  it("does not follow or delete a symlink candidate", () => {
    const outside = makeClone("OUTSID");
    age(outside);
    fs.renameSync(outside, path.join(root, "outside"));
    fs.symlinkSync(path.join(root, "outside"), path.join(work, "worktree.LINK01"));
    lib("retention_gc");
    expect(exists(path.join(root, "outside", ".git"))).toBe(true);
    expect(fs.lstatSync(path.join(work, "worktree.LINK01")).isSymbolicLink()).toBe(true);
  });

  it("fails closed when open-PR state is unavailable, settings are invalid, or the root is a symlink", () => {
    const dir = makeClone("OLD001");
    age(dir);
    lib("retention_gc", { FAKE_GH_FAIL: "1" });
    expect(exists(dir)).toBe(true);
    lib("retention_gc", { UPSTREAM_INTAKE_RETAIN_DAYS: "1" });
    expect(exists(dir)).toBe(true);
    lib("retention_gc", { UPSTREAM_INTAKE_RETAIN_DAYS: "abc" });
    expect(exists(dir)).toBe(true);
    const linkRoot = path.join(root, "work-link");
    fs.symlinkSync(work, linkRoot);
    lib("retention_gc", { WORK_ROOT: linkRoot });
    expect(exists(dir)).toBe(true);
  });

  it("skips when another GC holds the lock", () => {
    const dir = makeClone("OLD001");
    age(dir);
    lib('exec 8>"$WORK_ROOT/.gc.lock"; flock -n 8; retention_gc');
    expect(exists(dir)).toBe(true);
    lib("retention_gc");
    expect(exists(dir)).toBe(false);
  });
});

describe("retention_reclaim_failed", () => {
  const reclaim = (dir, env) => lib(`if retention_reclaim_failed "$D"; then echo REMOVED; else echo "KEPT:$RETENTION_REASON"; fi`, { D: dir, ...env });

  it("removes a fresh failed clone that holds nothing unpublished", () => {
    const dir = makeClone("FAIL01");
    expect(reclaim(dir)).toBe("REMOVED");
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("removes a failed clone whose branch is published without an open PR", () => {
    const dir = makeClone("FAIL02");
    git(dir, "checkout", "--quiet", "-b", "upstream-intake/p");
    commitIn(dir);
    git(dir, "push", "--quiet", path.join(root, "target.git"), "upstream-intake/p");
    expect(reclaim(dir)).toBe("REMOVED");
  });

  it("retains failed clones with unpublished commits, dirty edits, an open PR, or unknown PR state", () => {
    const unpublished = makeClone("FAIL03");
    git(unpublished, "checkout", "--quiet", "-b", "upstream-intake/u");
    commitIn(unpublished);
    expect(reclaim(unpublished)).toMatch(/^KEPT:branch upstream-intake\/u not on origin-literouter/);
    const dirty = makeClone("FAIL04");
    age(dirty, 1);
    fs.writeFileSync(path.join(dirty, "a.txt"), "changed");
    expect(reclaim(dirty)).toBe("KEPT:uncommitted or untracked edits");
    const clean = makeClone("FAIL05");
    expect(reclaim(clean, { FAKE_GH_FAIL: "1" })).toBe("KEPT:PR state unavailable");
    expect(fs.existsSync(clean)).toBe(true);
    const open = makeClone("FAIL06");
    git(open, "checkout", "--quiet", "-b", "upstream-intake/o");
    commitIn(open);
    git(open, "push", "--quiet", path.join(root, "target.git"), "upstream-intake/o");
    expect(reclaim(open, { FAKE_GH_OPEN: "upstream-intake/o" })).toBe("KEPT:branch upstream-intake/o has an open PR");
  });
});
