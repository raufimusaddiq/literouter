import { describe, it, expect } from "bun:test";
import { buildSnippets, PLACEHOLDER_KEY } from "../../src/web/pages/dashboard/endpoint/quickstartSnippets.js";
import { sortKeysByLastUsed } from "../../src/web/pages/dashboard/endpoint/keyFormat.js";

describe("buildSnippets", () => {
  const base = "http://localhost:20128/v1";
  const snippets = buildSnippets(base);
  it("provides curl, python and node", () => {
    expect(snippets.map((s) => s.id)).toEqual(["curl", "python", "node"]);
  });
  it("uses the base URL and only the placeholder key", () => {
    for (const s of snippets) {
      expect(s.code).toContain(base);
      expect(s.code).toContain(PLACEHOLDER_KEY);
      expect(s.code).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    }
  });
});

describe("sortKeysByLastUsed", () => {
  it("orders by last used desc with never-used last", () => {
    const keys = [{ id: "a", name: "a" }, { id: "b", name: "b" }, { id: "c", name: "c" }];
    const usage = { a: { lastUsed: null }, b: { lastUsed: "2026-02-01T00:00:00Z" }, c: { lastUsed: "2026-03-01T00:00:00Z" } };
    expect(sortKeysByLastUsed(keys, usage).map((k) => k.id)).toEqual(["c", "b", "a"]);
  });
});
