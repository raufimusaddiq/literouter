import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
