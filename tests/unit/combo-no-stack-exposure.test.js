import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

describe("combo error body never exposes stack traces", () => {
  it("returns a generic message when every model throws", async () => {
    const err = new Error("boom secret detail");
    const handleSingleModel = vi.fn().mockRejectedValue(err);
    const log = { info: vi.fn(), warn: vi.fn() };
    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["a/m1", "b/m2"], handleSingleModel, log,
      comboName: "c", comboStrategy: "fallback",
    });
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toMatch(/\n\s+at |\.js:\d+|node_modules|boom secret/);
    expect(text).not.toContain(err.stack);
    expect(JSON.parse(text).error.message).toBe("All combo models failed");
    // stack kept server-side only
    expect(log.warn.mock.calls.some((c) => c[2]?.stack === err.stack)).toBe(true);
  });
});
