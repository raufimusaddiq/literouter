import { describe, test, expect } from "bun:test";
import { parseJunit } from "../__baseline__/junit.mjs";
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
  test("parseJunit errors is 0 when the root has no errors attribute", () => {
    const { cases, errors } = parseJunit(xml);
    expect(errors).toBe(0);
    expect(cases.map((c) => c.file)).toEqual(["tests/unit/a.test.js"]);
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
