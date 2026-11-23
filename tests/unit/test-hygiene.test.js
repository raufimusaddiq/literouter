import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { findHygieneProblems, duplicateTitles } from "../../scripts/check-test-hygiene.mjs";

const dirs = [];

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "hygiene-"));
  dirs.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

const GOOD_TEST = 'import { it, expect } from "bun:test";\nit("a", () => { expect(1).toBe(1); });\n';

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe("test hygiene check", () => {
  it("passes a clean tree", () => {
    const root = tree({
      "tests/unit/a.test.js": 'import { used } from "#test/used";\nimport { it, expect } from "bun:test";\nit("a", () => { expect(used).toBe(1); readFile("tests/fixtures/data.json"); });\n',
      "tests/helpers/used.js": "export const used = 1;\n",
      "tests/fixtures/data.json": "{}\n",
      "cli/test/b.test.js": GOOD_TEST,
    });
    expect(findHygieneProblems(root)).toEqual([]);
  });

  it("flags a fixture that no test references", () => {
    const root = tree({
      "tests/unit/a.test.js": GOOD_TEST,
      "tests/fixtures/orphan.json": "{}\n",
    });
    expect(findHygieneProblems(root)).toEqual([{ rule: "unreferenced-fixture", file: "tests/fixtures/orphan.json" }]);
  });

  it("does not count a README mention as a reference", () => {
    const root = tree({
      "tests/unit/a.test.js": GOOD_TEST,
      "tests/fixtures/db/README.md": "see orphan.json\n",
      "tests/fixtures/db/orphan.json": "{}\n",
    });
    expect(findHygieneProblems(root).map((p) => p.rule)).toEqual(["unreferenced-fixture"]);
  });

  it("does not count a longer name containing the fixture basename as a reference", () => {
    const root = tree({
      "tests/unit/a.test.js": 'import { it, expect } from "bun:test";\nit("a", () => { expect(read("tests/fixtures/my-orphan.json")).toBe(1); });\n',
      "tests/fixtures/my-orphan.json": "{}\n",
      "tests/fixtures/orphan.json": "{}\n",
    });
    expect(findHygieneProblems(root)).toEqual([{ rule: "unreferenced-fixture", file: "tests/fixtures/orphan.json" }]);
  });

  it("lets an explicit allow entry cover a directory-loaded fixture", () => {
    const root = tree({
      "tests/unit/a.test.js": GOOD_TEST,
      "tests/fixtures/loaded/x.json": "{}\n",
    });
    const allow = [{ path: "tests/fixtures/loaded/", reason: "read by readdir" }];
    expect(findHygieneProblems(root, { allow })).toEqual([]);
  });

  it("exempts the parity corpora by directory", () => {
    const root = tree({
      "tests/unit/a.test.js": GOOD_TEST,
      "tests/parity/fixtures/case.json": "{}\n",
      "tests/parity/expected/case.json": "{}\n",
    });
    expect(findHygieneProblems(root)).toEqual([]);
  });

  it("flags a helper that no test imports", () => {
    const root = tree({
      "tests/unit/a.test.js": GOOD_TEST,
      "tests/helpers/dead.js": "export const dead = 1;\n",
    });
    expect(findHygieneProblems(root)).toEqual([{ rule: "unreferenced-helper", file: "tests/helpers/dead.js" }]);
  });

  it("does not count a same-stem import that resolves elsewhere", () => {
    const root = tree({
      "tests/unit/a.test.js": 'import { x } from "./other/shared.js";\nimport { it, expect } from "bun:test";\nit("a", () => expect(x).toBe(1));\n',
      "tests/unit/other/shared.js": "export const x = 1;\n",
      "tests/helpers/shared.js": "export const y = 1;\n",
    });
    expect(findHygieneProblems(root)).toEqual([{ rule: "unreferenced-helper", file: "tests/helpers/shared.js" }]);
  });

  it("accepts a helper imported by relative path from cli/test", () => {
    const root = tree({
      "cli/test/a.test.js": 'import { h } from "../../tests/helpers/h.js";\nimport { expect, it } from "bun:test";\nit("x", () => expect(h).toBe(1));\n',
      "tests/helpers/h.js": "export const h = 1;\n",
    });
    expect(findHygieneProblems(root)).toEqual([]);
  });

  it("flags a test file with no assertion", () => {
    const root = tree({
      "tests/unit/empty.test.js": 'import { it } from "bun:test";\nit("runs", () => {});\n',
    });
    expect(findHygieneProblems(root)).toEqual([{ rule: "no-assertions", file: "tests/unit/empty.test.js" }]);
  });

  it("flags an exact duplicate title in one file", () => {
    const root = tree({
      "tests/unit/dup.test.js": 'import { it, expect } from "bun:test";\nit("same", () => expect(1).toBe(1));\nit("same", () => expect(2).toBe(2));\n',
    });
    expect(findHygieneProblems(root)).toEqual([{ rule: "duplicate-title", file: "tests/unit/dup.test.js", detail: "same" }]);
  });

  it("scopes duplicate titles by describe block", () => {
    const src = 'describe("a", () => {\n  it("x", () => {});\n});\ndescribe("b", () => {\n  it("x", () => {});\n});\n';
    expect(duplicateTitles(src)).toEqual([]);
  });

  it("ignores templated and table titles", () => {
    const src = 'it.each(rows)("same", () => {});\nit.each(rows)("same", () => {});\nit(`v${n}`, () => {});\nit(`v${n}`, () => {});\n';
    expect(duplicateTitles(src)).toEqual([]);
  });
});
