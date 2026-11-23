import { describe, test, expect } from "bun:test";
import { parseJunit } from "../__baseline__/junit.mjs";
import { checkCounts, checkDeleted, pathsMismatch } from "../__baseline__/verify-test-counts.mjs";
import { findRegressions, findDuplicateKeys } from "../__baseline__/verify-no-regression.mjs";

const XML = String.raw`<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="4" failures="1" skipped="2" errors="2">
  <testsuite name="golden-url-header.test.js" file="D:\repo\tests\translator\golden-url-header.test.js" tests="4">
    <testsuite name="GOLDEN buildHeaders (default executor providers)" file="x" line="2" tests="2">
      <testcase name="cline &#8594; headers (apiKey / oauth)" classname="a" file="x" line="3">
        <failure type="AssertionError" message="boom&#10;">trace</failure>
      </testcase>
      <testcase name="a &amp; b" classname="a" file="x" line="4" />
    </testsuite>
    <testcase name="top skipped" classname="" file="x" line="9"><skipped /></testcase>
    <testcase name="todo one" classname="" file="x" line="10"><skipped message="TODO" /></testcase>
  </testsuite>
</testsuites>`;

describe("parseJunit", () => {
  const r = parseJunit(XML);
  test("full name, file, status, errors", () => {
    expect(r.cases).toEqual([
      { file: "tests/translator/golden-url-header.test.js", fullName: "GOLDEN buildHeaders (default executor providers) cline → headers (apiKey / oauth)", status: "failed" },
      { file: "tests/translator/golden-url-header.test.js", fullName: "GOLDEN buildHeaders (default executor providers) a & b", status: "passed" },
      { file: "tests/translator/golden-url-header.test.js", fullName: "top skipped", status: "skipped" },
      { file: "tests/translator/golden-url-header.test.js", fullName: "todo one", status: "skipped" },
    ]);
    expect(r.errors).toBe(2);
  });
  test("missing errors attr is 0; cwd-relative file gets tests/ prefix", () => {
    const x = `<testsuites><testsuite name="s" file="unit/x.test.js"><testcase name="t"/></testsuite></testsuites>`;
    const p = parseJunit(x);
    expect(p.errors).toBe(0);
    expect(p.cases[0].file).toBe("tests/unit/x.test.js");
  });
});

describe("checkCounts", () => {
  test("flags files below baseline, including missing files", () => {
    const { cases } = parseJunit(XML);
    const base = { "tests/translator/golden-url-header.test.js": 5, "tests/unit/gone.test.js": 1, "tests/ok.test.js": 0 };
    expect(checkCounts(base, cases)).toEqual([
      { file: "tests/translator/golden-url-header.test.js", expected: 5, actual: 4 },
      { file: "tests/unit/gone.test.js", expected: 1, actual: 0 },
    ]);
    expect(checkCounts({ "tests/translator/golden-url-header.test.js": 4 }, cases)).toEqual([]);
  });
});

describe("findRegressions", () => {
  const parsed = parseJunit(XML);
  const key = "tests/translator/golden-url-header.test.js :: GOLDEN buildHeaders (default executor providers) cline → headers (apiKey / oauth)";
  test("known fail is accepted when there are no root errors", () => {
    const r = findRegressions({ ...parsed, errors: 0 }, new Set([key]));
    expect(r.regressions).toEqual([]);
    expect(r.unattributedErrors).toBe(0);
  });
  test("unknown fail is a regression", () => {
    expect(findRegressions(parsed, new Set()).regressions).toEqual([key]);
  });
  test("root errors > 0 is strict: fails even when a known fail exists", () => {
    expect(findRegressions(parsed, new Set([key])).unattributedErrors).toBe(2);
  });
});

describe("load failure (real Bun shape: file absent, no root errors)", () => {
  const xml = `<testsuites name="bun test" tests="1"><testsuite name="a.test.js" file="unit/a.test.js"><testcase name="t"/></testsuite></testsuites>`;
  test("parseJunit errors is 0 and counts gate flags the missing file", () => {
    const { cases, errors } = parseJunit(xml);
    expect(errors).toBe(0);
    expect(checkCounts({ "tests/unit/a.test.js": 1, "tests/unit/broken.test.js": 7 }, cases))
      .toEqual([{ file: "tests/unit/broken.test.js", expected: 7, actual: 0 }]);
  });
  test("pathsMismatch detects junit not produced from tests/", () => {
    const { cases } = parseJunit(xml);
    expect(pathsMismatch({ "tests/unit/a.test.js": 1 }, cases)).toBe(false);
    expect(pathsMismatch({ "tests/unit/other.test.js": 1 }, cases)).toBe(true);
  });
});

describe("findDuplicateKeys", () => {
  test("lists file :: fullName keys that occur more than once with their counts", () => {
    const cases = [
      { file: "tests/a.test.js", fullName: "x when %s", status: "passed" },
      { file: "tests/a.test.js", fullName: "x when %s", status: "failed" },
      { file: "tests/a.test.js", fullName: "x when %s", status: "passed" },
      { file: "tests/a.test.js", fullName: "unique", status: "passed" },
      { file: "tests/b.test.js", fullName: "x when %s", status: "passed" },
    ];
    expect(findDuplicateKeys(cases)).toEqual([{ key: "tests/a.test.js :: x when %s", count: 3 }]);
    expect(findDuplicateKeys([])).toEqual([]);
  });
});

describe("deleted records against the frozen baseline", () => {
  const cases = [
    { file: "tests/a.test.js", fullName: "kept", status: "passed" },
    { file: "tests/a.test.js", fullName: "other", status: "passed" },
  ];
  const del = { "tests/a.test.js :: gone": "dead export" };

  test("a recorded deletion lowers the expected count by one per entry", () => {
    expect(checkCounts({ "tests/a.test.js": 3 }, cases, del)).toEqual([]);
    expect(checkCounts({ "tests/a.test.js": 4 }, cases, del)).toEqual([{ file: "tests/a.test.js", expected: 3, actual: 2 }]);
  });
  test("a lowered count without an entry fails because files stay frozen", () => {
    expect(checkCounts({ "tests/a.test.js": 3 }, cases, {})).toEqual([{ file: "tests/a.test.js", expected: 3, actual: 2 }]);
  });
  test("a lost case is not hidden by an entry for a different file", () => {
    expect(checkCounts({ "tests/a.test.js": 3 }, cases, { "tests/b.test.js :: gone": "r" })).toEqual([{ file: "tests/a.test.js", expected: 3, actual: 2 }]);
  });
  test("accepts an entry for a case that vanished", () => {
    expect(checkDeleted({ "tests/a.test.js": 3 }, del, cases)).toEqual([]);
  });
  test("a file with a deleted entry that later gains tests still passes", () => {
    const grown = [...cases, { file: "tests/a.test.js", fullName: "added later 1", status: "passed" }, { file: "tests/a.test.js", fullName: "added later 2", status: "passed" }];
    expect(checkDeleted({ "tests/a.test.js": 3 }, del, grown)).toEqual([]);
    expect(checkCounts({ "tests/a.test.js": 3 }, grown, del)).toEqual([]);
  });
  test("flags a deleted case that still runs", () => {
    expect(checkDeleted({ "tests/a.test.js": 3 }, { "tests/a.test.js :: kept": "r" }, cases))
      .toEqual([{ key: "tests/a.test.js :: kept", problem: "case still present in junit" }]);
  });
  test("flags an entry whose file has no frozen count", () => {
    expect(checkDeleted({}, del, cases)).toEqual([{ key: "tests/a.test.js :: gone", problem: "file is not in the baseline files map" }]);
  });
  test("whole-file entry: no junit cases, and the stated count equals the frozen count", () => {
    const whole = { "tests/z.test.js :: *": "vacuous (1 case)" };
    expect(checkDeleted({ "tests/z.test.js": 1 }, whole, cases)).toEqual([]);
    expect(checkCounts({ "tests/z.test.js": 1 }, cases, whole)).toEqual([]);
    expect(checkDeleted({ "tests/z.test.js": 2 }, whole, cases))
      .toEqual([{ key: "tests/z.test.js :: *", problem: "stated count 1 differs from frozen count 2" }]);
    expect(checkDeleted({ "tests/z.test.js": 1 }, { "tests/z.test.js :: *": "vacuous" }, cases))
      .toEqual([{ key: "tests/z.test.js :: *", problem: "value must state '(N cases)'" }]);
    expect(checkDeleted({}, whole, cases)).toEqual([{ key: "tests/z.test.js :: *", problem: "file is not in the baseline files map" }]);
    expect(checkDeleted({ "tests/a.test.js": 2 }, { "tests/a.test.js :: *": "r (2 cases)" }, cases))
      .toEqual([{ key: "tests/a.test.js :: *", problem: "file still present in junit" }]);
  });
  test("rejects a malformed key", () => {
    expect(checkDeleted({}, { "no separator": "r" }, cases)).toEqual([{ key: "no separator", problem: "key must be '<file> :: <name>'" }]);
  });
});
