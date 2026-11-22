import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RuleTester } from "eslint";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const toUrl = (rel) => pathToFileURL(path.join(repo, rel)).href;
const { findComments } = await import(toUrl("scripts/comments/lib.mjs"));
const { applyDecisions } = await import(toUrl("scripts/comments/apply.mjs"));
const { default: noComments } = await import(toUrl("eslint-rules/no-comments.mjs"));

const only = (src, file = "a.js") => findComments(src, file);

describe("findComments", () => {
  it("finds line, block and jsdoc comments with ranges", () => {
    const src = "// one\nconst a = 1; /* two */\n/** three */\nfunction f() {}\n";
    const c = only(src);
    expect(c.map((x) => x.kind)).toEqual(["Line", "Block", "Block"]);
    expect(c.map((x) => x.text)).toEqual([" one", " two ", "* three "]);
    expect(src.slice(c[0].start, c[0].end)).toBe("// one");
    expect(src.slice(c[1].start, c[1].end)).toBe("/* two */");
    expect(src.slice(c[2].start, c[2].end)).toBe("/** three */");
    expect(c[1].startLine).toBe(2);
    expect(c[1].startCol).toBe(13);
    expect(c[2].endLine).toBe(3);
  });

  it("reports multi-line block ranges", () => {
    const src = "x();\n/*\n a\n b\n*/\ny();\n";
    const [c] = only(src);
    expect(c.startLine).toBe(2);
    expect(c.endLine).toBe(5);
  });

  it("detects jsx comments and covers the braces", () => {
    const src = "const a = <div>{/* hi */}<b/></div>;\n";
    const c = only(src);
    expect(c).toHaveLength(1);
    expect(c[0].kind).toBe("Jsx");
    expect(src.slice(c[0].start, c[0].end)).toBe("{/* hi */}");
    expect(c[0].text).toBe(" hi ");
  });

  it("keeps a plain comment in a non-empty jsx container as Block", () => {
    const src = "const a = <div>{x /* hi */}</div>;\n";
    expect(only(src)[0].kind).toBe("Block");
  });

  it("flags directives", () => {
    const src = [
      "// eslint-disable-next-line no-console",
      "/* eslint-enable */",
      "/* global foo */",
      "/* istanbul ignore next */",
      "// @ts-ignore",
      "// prettier-ignore",
      "import(/* webpackIgnore: true */ 'x');",
      "const p = /*#__PURE__*/ f();",
      "/*! @license MIT */",
      "// plain words",
    ].join("\n");
    const flags = only(src).map((x) => x.isDirective);
    expect(flags).toEqual([true, true, true, true, true, true, true, true, true, false]);
  });

  it("does not treat strings or templates as comments", () => {
    const src = 'const a = "// no"; const b = `/* no */ ${1}`; const r = /a\\/\\/b/;\n';
    expect(only(src)).toEqual([]);
  });

  it("parses files with a top-level return and a shebang", () => {
    const src = "#!/usr/bin/env node\n// top\nif (x) return;\n";
    const c = only(src, "cli/cli.js");
    expect(c).toHaveLength(1);
    expect(c[0].startLine).toBe(2);
  });

  it("builds ids from the posix path, line and column", () => {
    const [c] = only("a();\n  // x\n", "src\\deep\\f.js");
    expect(c.id).toBe("src/deep/f.js#2:2");
    expect(c.file).toBe("src/deep/f.js");
  });

  it("throws when the file cannot be parsed", () => {
    expect(() => only("const = ;")).toThrow();
  });
});

describe("applyDecisions", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = (src, pick = () => true, opts = {}) => {
    fs.writeFileSync(path.join(dir, "a.js"), src);
    const decisions = findComments(src, "a.js")
      .filter((c) => !c.isDirective && pick(c))
      .map((c) => ({ id: c.id, category: "tautology" }));
    const summary = applyDecisions({ root: dir, decisions, ...opts });
    return { summary, out: fs.readFileSync(path.join(dir, "a.js"), "utf8") };
  };

  it("removes an own-line comment with its line", () => {
    const { out, summary } = run("a();\n  // gone\nb();\n");
    expect(out).toBe("a();\nb();\n");
    expect(summary.deleted).toBe(1);
    expect(summary.filesChanged).toBe(1);
  });

  it("trims a trailing comment", () => {
    expect(run("a(); // gone\nb();\n").out).toBe("a();\nb();\n");
    expect(run("a(); /* gone */\nb();\n").out).toBe("a();\nb();\n");
  });

  it("collapses doubled spaces around an inline comment", () => {
    expect(run("foo(a, /* x */ b);\n").out).toBe("foo(a, b);\n");
  });

  it("removes a multi-line block comment", () => {
    expect(run("a();\n/**\n * doc\n */\nb();\n").out).toBe("a();\nb();\n");
  });

  it("does not merge lines when a block spans code on both ends", () => {
    expect(run("a(); /* x\n y */ b();\n").out).toBe("a();\nb();\n");
  });

  it("removes a jsx comment with its braces", () => {
    const { out } = run("const a = (\n  <div>\n    {/* gone */}\n    <b />\n  </div>\n);\n");
    expect(out).toBe("const a = (\n  <div>\n    <b />\n  </div>\n);\n");
    expect(run("const a = <i>{/* x */}hi</i>;\n").out).toBe("const a = <i>hi</i>;\n");
  });

  it("handles crlf files and a final line without newline", () => {
    expect(run("a();\r\n// x\r\nb();\r\n").out).toBe("a();\r\nb();\r\n");
    expect(run("a();\n// x").out).toBe("a();");
  });

  it("leaves directives untouched, even when decided", () => {
    const src = "// eslint-disable-next-line no-console\nconsole.log(1);\n";
    fs.writeFileSync(path.join(dir, "a.js"), src);
    const summary = applyDecisions({
      root: dir,
      decisions: [{ id: "a.js#1:0", category: "tautology" }],
    });
    expect(fs.readFileSync(path.join(dir, "a.js"), "utf8")).toBe(src);
    expect(summary.deleted).toBe(0);
    expect(summary.skipped).toHaveLength(1);
  });

  it("keeps comments decided as keep", () => {
    const src = "// stay\na();\n";
    fs.writeFileSync(path.join(dir, "a.js"), src);
    const summary = applyDecisions({ root: dir, decisions: [{ id: "a.js#1:0", category: "keep" }] });
    expect(fs.readFileSync(path.join(dir, "a.js"), "utf8")).toBe(src);
    expect(summary.deleted).toBe(0);
  });

  it("deletes stale, excuse and decision categories", () => {
    const src = "// a\n// b\n// c\nx();\n";
    fs.writeFileSync(path.join(dir, "a.js"), src);
    const summary = applyDecisions({
      root: dir,
      decisions: [
        { id: "a.js#1:0", category: "stale" },
        { id: "a.js#2:0", category: "excuse" },
        { id: "a.js#3:0", category: "decision" },
      ],
    });
    expect(summary.deleted).toBe(3);
    expect(fs.readFileSync(path.join(dir, "a.js"), "utf8")).toBe("x();\n");
  });

  it("skips and reports a stale id", () => {
    fs.writeFileSync(path.join(dir, "a.js"), "// x\na();\n");
    const summary = applyDecisions({
      root: dir,
      decisions: [{ id: "a.js#9:9", category: "tautology" }],
    });
    expect(summary.deleted).toBe(0);
    expect(summary.skipped).toEqual([{ id: "a.js#9:9", reason: expect.any(String) }]);
    expect(summary.filesChanged).toBe(0);
  });

  it("does nothing on dry run", () => {
    const src = "// x\na();\n";
    const { out, summary } = run(src, () => true, { dryRun: true });
    expect(out).toBe(src);
    expect(summary.deleted).toBe(1);
    expect(summary.filesChanged).toBe(1);
  });

  it("re-parses and keeps the original when the result is broken", () => {
    const src = "// x\na();\n";
    fs.writeFileSync(path.join(dir, "a.js"), src);
    const summary = applyDecisions({
      root: dir,
      decisions: [{ id: "a.js#1:0", category: "tautology" }],
      verify: () => {
        throw new Error("forced");
      },
    });
    expect(fs.readFileSync(path.join(dir, "a.js"), "utf8")).toBe(src);
    expect(summary.failedFiles).toEqual([{ file: "a.js", error: expect.stringContaining("forced") }]);
    expect(summary.filesChanged).toBe(0);
  });

  it("is usable from the command line", () => {
    fs.writeFileSync(path.join(dir, "a.js"), "// x\na();\n");
    const decisions = path.join(dir, "d.jsonl");
    fs.writeFileSync(decisions, JSON.stringify({ id: "a.js#1:0", category: "tautology" }) + "\n");
    const script = path.join(repo, "scripts/comments/apply.mjs");
    const dry = spawnSync(process.execPath, [script, "--decisions", decisions, "--dry-run"], { cwd: dir, encoding: "utf8" });
    expect(dry.status).toBe(0);
    expect(fs.readFileSync(path.join(dir, "a.js"), "utf8")).toBe("// x\na();\n");
    expect(JSON.parse(dry.stdout).deleted).toBe(1);
    const real = spawnSync(process.execPath, [script, "--decisions", decisions], { cwd: dir, encoding: "utf8" });
    expect(real.status).toBe(0);
    expect(fs.readFileSync(path.join(dir, "a.js"), "utf8")).toBe("a();\n");
  });
});

describe("ratchet", () => {
  let dir;
  const script = path.join(repo, "scripts/comments/ratchet.mjs");
  const ratchet = (flag) => spawnSync(process.execPath, [script, flag], { cwd: dir, encoding: "utf8" });
  const put = (rel, src) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), src);
    execFileSync("git", ["add", "-A"], { cwd: dir });
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir });
    put("a.js", "// one\n// two\nx();\n");
    put("src/b.js", "/* eslint-disable */\ny();\n");
    put("src/c.js", "z();\n");
    put("notes.md", "// not source\n");
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes a sorted baseline of non-directive counts above zero", () => {
    expect(ratchet("--write").status).toBe(0);
    const text = fs.readFileSync(path.join(dir, ".comment-baseline.json"), "utf8");
    expect(JSON.parse(text)).toEqual({ "a.js": 2 });
  });

  it("passes when equal", () => {
    ratchet("--write");
    expect(ratchet("--check").status).toBe(0);
  });

  it("fails when a count increases or a new file has comments", () => {
    ratchet("--write");
    put("a.js", "// one\n// two\n// three\nx();\n");
    put("src/c.js", "// new\nz();\n");
    const r = ratchet("--check");
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain("a.js");
    expect(r.stdout + r.stderr).toContain("src/c.js");
  });

  it("fails when a count decreases and points at --write", () => {
    ratchet("--write");
    put("a.js", "// one\nx();\n");
    const r = ratchet("--check");
    expect(r.status).toBe(1);
    const out = r.stdout + r.stderr;
    expect(out).toContain("a.js");
    expect(out).toContain("node scripts/comments/ratchet.mjs --write");
  });
});

describe("local/no-comments", () => {
  const root = process.cwd();
  const opts = (baseline) => [{ baseline, root }];
  const message = (n, m) =>
    `Comments are banned in this repo (file has ${n}, baseline allows ${m}). Delete the comment; record decisions in docs/adr/.`;
  const tester = new RuleTester({
    languageOptions: { ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
  });

  tester.run("no-comments", noComments, {
    valid: [
      { code: "a();\n", filename: "src/a.js", options: opts({}) },
      { code: "// one\na();\n", filename: "src/a.js", options: opts({ "src/a.js": 1 }) },
      { code: "// one\na();\n", filename: "src/a.js", options: opts({ "src/a.js": 5 }) },
      {
        code: "// eslint-disable-next-line no-console\nconsole.log(1);\n/* global foo */\n",
        filename: "src/a.js",
        options: opts({}),
      },
    ],
    invalid: [
      {
        code: "// one\n/* two */\na();\n",
        filename: "src/a.js",
        options: opts({ "src/a.js": 1 }),
        errors: [{ message: message(2, 1) }, { message: message(2, 1) }],
      },
      {
        code: "// one\na();\n",
        filename: "src/new.js",
        options: opts({}),
        errors: [{ message: message(1, 0), line: 1 }],
      },
      {
        code: "// eslint-disable-next-line no-console\n// real\nconsole.log(1);\n",
        filename: "src/a.js",
        options: opts({}),
        errors: [{ message: message(1, 0), line: 2 }],
      },
      {
        code: "const a = <div>{/* x */}</div>;\n",
        filename: "src/a.jsx",
        options: opts({}),
        errors: [{ message: message(1, 0) }],
      },
    ],
  });
});
