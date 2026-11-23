import { describe, test, expect } from "bun:test";
import { parseJunit } from "../__baseline__/junit.mjs";
import { checkCounts, checkDeleted, checkSkips, checkWaived, pathsMismatch } from "../__baseline__/verify-test-counts.mjs";
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

describe("skip gate", () => {
  const sk = (file, n, name = "s") => Array.from({ length: n }, (_, i) => ({ file, fullName: `${name} ${i}`, status: "skipped" }));
  const ok = file => ({ file, fullName: "p", status: "passed" });

  test("fails when a file skips more than its frozen baseline", () => {
    const cases = [ok("tests/a.test.js"), ...sk("tests/a.test.js", 3)];
    expect(checkSkips({ "tests/a.test.js": 2 }, cases)).toEqual([{ file: "tests/a.test.js", allowed: 2, actual: 3 }]);
  });
  test("passes at or below the baseline", () => {
    const cases = [ok("tests/a.test.js"), ...sk("tests/a.test.js", 2)];
    expect(checkSkips({ "tests/a.test.js": 2 }, cases)).toEqual([]);
    expect(checkSkips({ "tests/a.test.js": 5 }, cases)).toEqual([]);
  });
  test("a file absent from the baseline map may not skip at all", () => {
    expect(checkSkips({}, [...sk("tests/new.test.js", 1)])).toEqual([{ file: "tests/new.test.js", allowed: 0, actual: 1 }]);
    expect(checkSkips({}, [ok("tests/new.test.js")])).toEqual([]);
  });
  test("a waiver lets a file exceed its baseline", () => {
    const cases = sk("tests/a.test.js", 3);
    expect(checkSkips({ "tests/a.test.js": 1 }, cases, { "tests/a.test.js": "needs live credentials" })).toEqual([]);
  });
  test("a waiver for another file does not hide the offender", () => {
    expect(checkSkips({}, sk("tests/a.test.js", 1), { "tests/b.test.js": "r" })).toEqual([{ file: "tests/a.test.js", allowed: 0, actual: 1 }]);
  });
  test("ignores Bun's real unnamed placeholder for a skipped describe", () => {
    const xml = String.raw`<testsuites name="bun test"><testsuite name="translator\real\file-base64-survey.real.test.js" file="translator\real\file-base64-survey.real.test.js" tests="2" assertions="0" failures="0" skipped="2" time="0.05" hostname="">
    <testsuite name="REAL file base64 survey" file="translator\real\file-base64-survey.real.test.js" line="95" tests="2" assertions="0" failures="0" skipped="2" time="0" hostname="">
      <testcase name="has active providers in DB" classname="REAL file base64 survey" time="0" file="translator\real\file-base64-survey.real.test.js" line="98" assertions="0">
        <skipped />
      </testcase>
      <testcase name="(unnamed)" classname="REAL file base64 survey" time="0" file="translator\real\file-base64-survey.real.test.js" assertions="0">
        <skipped />
      </testcase>
    </testsuite>
  </testsuite></testsuites>`;
    const { cases } = parseJunit(xml);
    expect(cases).toHaveLength(2);
    expect(checkSkips({ "tests/translator/real/file-base64-survey.real.test.js": 1 }, cases)).toEqual([]);
    expect(checkSkips({}, cases)).toEqual([{ file: "tests/translator/real/file-base64-survey.real.test.js", allowed: 0, actual: 1 }]);
  });
  test("catches a real skipped test named exactly (unnamed)", () => {
    const xml = `<testsuites><testsuite name="a.test.js" file="tests/a.test.js"><testsuite name="d" file="tests/a.test.js" line="1" tests="1" skipped="1"><testcase name="(unnamed)" classname="d" file="tests/a.test.js" line="2"><skipped /></testcase></testsuite></testsuite></testsuites>`;
    expect(checkSkips({}, parseJunit(xml).cases)).toEqual([{ file: "tests/a.test.js", allowed: 0, actual: 1 }]);
  });
  test("catches a real skipped test whose name ends in (unnamed)", () => {
    const xml = `<testsuites><testsuite name="a.test.js" file="tests/a.test.js"><testsuite name="d" file="tests/a.test.js" line="1" tests="1" skipped="1"><testcase name="case (unnamed)" classname="d" file="tests/a.test.js" line="2"><skipped /></testcase></testsuite></testsuite></testsuites>`;
    expect(checkSkips({}, parseJunit(xml).cases)).toEqual([{ file: "tests/a.test.js", allowed: 0, actual: 1 }]);
  });
  test("a placeholder-shaped case in a suite with non-skipped cases is still counted", () => {
    const xml = `<testsuites><testsuite name="a.test.js" file="tests/a.test.js"><testsuite name="d" file="tests/a.test.js" line="1" tests="2" skipped="1"><testcase name="ok" file="tests/a.test.js" line="2"/><testcase name="(unnamed)" file="tests/a.test.js"><skipped /></testcase></testsuite></testsuite></testsuites>`;
    expect(checkSkips({}, parseJunit(xml).cases)).toEqual([{ file: "tests/a.test.js", allowed: 0, actual: 1 }]);
  });
  test("failed and passed cases never count as skips", () => {
    expect(checkSkips({}, [ok("tests/a.test.js"), { file: "tests/a.test.js", fullName: "f", status: "failed" }])).toEqual([]);
  });
});

describe("waived files against the frozen baseline", () => {
  const caseFor = (file, n) => Array.from({ length: n }, (_, i) => ({ file, fullName: `case ${i}`, status: "passed" }));
  const waived = { "tests/old.test.js": "tests/server/new.test.js — replaced by the Bun.serve harness" };
  const base = { "tests/old.test.js": 3, "tests/keep.test.js": 1 };

  test("a waived file passes when its replacement runs at least as many cases", () => {
    const cases = [...caseFor("tests/keep.test.js", 1), ...caseFor("tests/server/new.test.js", 3)];
    expect(checkWaived(base, waived, cases)).toEqual([]);
    expect(checkCounts(base, cases, {}, waived)).toEqual([]);
    expect(checkWaived(base, waived, [...cases, ...caseFor("tests/server/new.test.js", 2)])).toEqual([]);
  });

  test("a waived file fails when the replacement is missing from junit", () => {
    const cases = caseFor("tests/keep.test.js", 1);
    expect(checkWaived(base, waived, cases)).toEqual([
      { key: "tests/old.test.js", problem: "replacement tests/server/new.test.js is not in junit" },
    ]);
  });

  test("a waived file fails when the replacement has fewer cases than the baseline", () => {
    const cases = [...caseFor("tests/keep.test.js", 1), ...caseFor("tests/server/new.test.js", 2)];
    expect(checkWaived(base, waived, cases)).toEqual([
      { key: "tests/old.test.js", problem: "replacement tests/server/new.test.js has 2 cases, baseline has 3" },
    ]);
  });

  test("a waiver does not hide a drop in a different file", () => {
    const cases = caseFor("tests/server/new.test.js", 3);
    expect(checkCounts(base, cases, {}, waived)).toEqual([{ file: "tests/keep.test.js", expected: 1, actual: 0 }]);
  });

  test("without a waiver the old file still fails the count gate", () => {
    const cases = [...caseFor("tests/keep.test.js", 1), ...caseFor("tests/server/new.test.js", 3)];
    expect(checkCounts(base, cases, {}, {})).toEqual([{ file: "tests/old.test.js", expected: 3, actual: 0 }]);
  });

  test("rejects a malformed value, an unknown file, and a replacement that is itself waived", () => {
    const cases = caseFor("tests/server/new.test.js", 3);
    expect(checkWaived(base, { "tests/old.test.js": "no separator" }, cases)).toEqual([
      { key: "tests/old.test.js", problem: "value must be '<replacement file> — <reason>'" },
    ]);
    expect(checkWaived(base, { "tests/ghost.test.js": "tests/server/new.test.js — r" }, cases)).toEqual([
      { key: "tests/ghost.test.js", problem: "file is not in the baseline files map" },
    ]);
    expect(checkWaived(base, { "tests/old.test.js": "tests/old.test.js — self" }, cases)).toEqual([
      { key: "tests/old.test.js", problem: "replacement must be a different file" },
    ]);
  });
});
