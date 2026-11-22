import { describe, test, expect } from "bun:test";
import { parseJunit } from "../__baseline__/junit.mjs";
import { checkCounts } from "../__baseline__/verify-test-counts.mjs";
import { findRegressions } from "../__baseline__/verify-no-regression.mjs";

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
  test("known fail with errors is accepted", () => {
    const r = findRegressions(parsed, new Set([key]));
    expect(r.regressions).toEqual([]);
    expect(r.unattributedErrors).toBe(0);
  });
  test("unknown fail is a regression; errors with no known fail are flagged", () => {
    const r = findRegressions(parsed, new Set());
    expect(r.regressions).toEqual([key]);
    expect(r.unattributedErrors).toBe(2);
  });
});
