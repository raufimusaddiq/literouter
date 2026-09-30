import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = readFileSync(new URL("../../scripts/upstream-intake.sh", import.meta.url), "utf8");
const helpers = script.slice(script.indexOf("log()"), script.indexOf("trap cleanup EXIT"));
const head = "a".repeat(40);
const merged = "b".repeat(40);
const approved = {
  headRefOid: head,
  mergeStateStatus: "CLEAN",
  statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
  reviews: [{ author: { login: "personal-code-reviewer" }, commit: { oid: head }, state: "APPROVED" }],
};

function run(body, data = approved) {
  const dir = mkdtempSync(join(tmpdir(), "worktree."));
  const file = join(dir, "run.sh");
  writeFileSync(file, `set -euo pipefail\n${helpers}\nLOG_PREFIX=test\nREPO=/repo\nTARGET=origin-literouter\n${body}\n`);
  try {
    return spawnSync("bash", [file], {
      env: { ...process.env, PR_DATA: JSON.stringify(data), MERGED: merged, TEST_WORKTREE: dir, TEST_WORK_ROOT: tmpdir() },
      encoding: "utf8",
      timeout: 4000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}


const mockView = `
gh() { while [ "$#" -gt 0 ]; do
  if [ "$1" = --jq ]; then jq -r "$2" <<< "$PR_DATA"; return; fi
  shift
done; return 1; }
sleep() { exit 77; }
wait_for_gates 75
`;

describe("upstream intake shell lifecycle", () => {
  it("accepts green checks and current-head Hermes approval", () => {
    expect(run(mockView).status).toBe(0);
  });

  it("waits for checks, current-head approval, and the actual Hermes reviewer", () => {
    for (const data of [
      { ...approved, statusCheckRollup: [] },
      { ...approved, statusCheckRollup: [{ status: "IN_PROGRESS", conclusion: "" }] },
      { ...approved, statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE" }] },
      { ...approved, reviews: [{ ...approved.reviews[0], commit: { oid: merged } }] },
      { ...approved, reviews: [{ ...approved.reviews[0], author: { login: "someone-else" } }] },
    ]) expect(run(mockView, data).status).toBe(77);
  });

  it("fails closed on review blockers and GitHub errors", () => {
    expect(run(mockView, { ...approved, reviews: [{ ...approved.reviews[0], state: "CHANGES_REQUESTED" }] }).status).toBe(1);
    expect(run("gh() { return 1; }; wait_for_gates 75").status).toBe(1);
  });

  it("pulls the merged SHA, never the PR head, after checking host health", () => {
    const result = run(`
gh() { case "$1 $2" in
  "pr merge") echo "merge $*";;
  "pr view") echo "$MERGED";;
  "run list") echo '123 completed success';;
  *) return 1;; esac; }
git() { return 0; }
check_host_health() { echo host-gate; }
docker() { case "$1" in
  pull) echo "$*";;
  compose) echo "tag=$LITEROUTER_PRODUCTION_TAG";;
  inspect) if [[ "$*" = *State.Health* ]]; then echo healthy;
    else echo "image:production-$MERGED"; fi;; esac; }
curl() { return 0; }
deploy_main '${head}' 75
`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`--match-head-commit ${head}`);
    expect(result.stdout).toContain(`host-gate\npull ghcr.io/raufimusaddiq/literouter-production:production-${merged}`);
    expect(result.stdout).toContain(`tag=production-${merged}`);
  });

  it("keeps failed workspaces, removes only the successful run worktree", () => {
    const body = `DEPLOY=true\nWORK_ROOT="$TEST_WORK_ROOT"\nWORKTREE="$TEST_WORKTREE"\nrm() { echo "removed $*"; }\ntrap cleanup EXIT\n`;
    const failed = run(`${body}false`);
    expect(failed.status).toBe(1);
    expect(failed.stdout).toContain("retaining workspace");
    expect(failed.stdout).not.toContain("removed -rf");
    const success = run(`${body}true`);
    expect(success.status).toBe(0);
    expect(success.stdout).toContain("removed -rf -- ");
    expect(script).not.toContain('rm -rf "$WORK_ROOT"');
  });

  it("lists all commits without a pipefail SIGPIPE and uses ephemeral yolo", () => {
    expect(script).not.toContain("| head -50");
    expect(script).toContain('codex_sandbox exec --yolo --ephemeral --cd "$WORKTREE"');
    expect(script).toContain('fetch --quiet "$TARGET" "$BASE_BRANCH"');
    expect(script).toContain("--clearenv");
    expect(script).toContain("--tmpfs /tmp --dir /tmp/.codex");
    expect(script).toContain("--setenv PATH /opt/node:/usr/bin:/bin");
    expect(script).toContain('--ro-bind "$NODE_BIN" /opt/node/node');
    expect(script).toContain('git clone --no-hardlinks --no-checkout "$REPO" "$WORKTREE"');
    expect(script).not.toContain("--ro-bind /etc /etc");
    expect(script).not.toContain('worktree add --detach');
  });
});
