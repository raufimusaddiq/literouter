import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The account fallback loop must stay explicitly bounded (PRD 24: no unbounded
// retry loop). Assert the guard exists in the request path rather than mocking
// the whole handler.
describe("account fallback bound", () => {
  const source = readFileSync(new URL("../../src/sse/handlers/chat.js", import.meta.url), "utf8");

  it("caps account attempts", () => {
    expect(source).toContain("while (true)");
    expect(source).toMatch(/maxAccountAttempts/);
    expect(source).toMatch(/accountAttempts > maxAccountAttempts/);
  });

  it("keeps fallback finite by excluding failed accounts", () => {
    expect(source).toMatch(/excludeConnectionIds\.add\(credentials\.connectionId\)/);
  });
});
