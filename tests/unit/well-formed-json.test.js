// kenari answered 400 "invalid JSON: lone leading surrogate in hex escape" for bodies
// holding a split emoji; the gateway must send U+FFFD instead of a bare \udXXX escape.
import { describe, it, expect } from "vitest";
import { stringifyWellFormed } from "../../open-sse/utils/wellFormedJson.js";

describe("stringifyWellFormed", () => {
  it("replaces a lone high surrogate", () => {
    const out = stringifyWellFormed({ text: "ab\ud83d" });
    expect(out).not.toMatch(/\\ud[89a-f]/i);
    expect(JSON.parse(out).text).toBe("ab�");
  });
  it("replaces a lone low surrogate and nested values", () => {
    const out = stringifyWellFormed({ a: [{ b: "\ude00x" }] });
    expect(JSON.parse(out).a[0].b).toBe("�x");
  });
  it("keeps a valid surrogate pair", () => {
    const out = stringifyWellFormed({ text: "ok 😀" });
    expect(JSON.parse(out).text).toBe("ok 😀");
  });
  it("matches JSON.stringify when there is nothing to repair", () => {
    const v = { a: 1, b: ["x", null], c: { d: "e\\ud83d" } };
    expect(stringifyWellFormed(v)).toBe(JSON.stringify(v));
  });
});
