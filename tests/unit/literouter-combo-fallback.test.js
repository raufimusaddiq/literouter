import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    clone: () => ({ json: async () => body }),
  };
}

const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), line: vi.fn() };

describe("combo fallback", () => {
  it("advances to the next candidate after a retryable failure", async () => {
    const attempts = [];
    const handleSingleModel = vi.fn(async (body, model) => {
      attempts.push(model);
      return model === "a/1" ? response(503, { error: { message: "overloaded" } }) : response(200);
    });

    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["a/1", "b/2"],
      handleSingleModel,
      log,
      comboName: "fallback-test",
      comboStrategy: "fallback",
      autoSwitch: false,
    });

    expect(attempts).toEqual(["a/1", "b/2"]);
    expect(result.ok).toBe(true);
  });

  it("tries each candidate exactly once (finite retry bound)", async () => {
    const attempts = [];
    const handleSingleModel = vi.fn(async (body, model) => {
      attempts.push(model);
      // 500 has no transient cooldown wait, so this asserts the retry bound
      // without depending on the deliberate 503 backoff sleep.
      return response(500, { error: { message: "upstream exploded" } });
    });

    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["a/1", "b/2", "c/3"],
      handleSingleModel,
      log,
      comboName: "bounded-test",
      comboStrategy: "fallback",
      autoSwitch: false,
    });

    expect(attempts).toEqual(["a/1", "b/2", "c/3"]);
    expect(new Set(attempts).size).toBe(attempts.length);
    expect(result.ok).toBe(false);
  }, 15000);

  it("waits at most the bounded cooldown before trying the next candidate", async () => {
    const startedAt = Date.now();
    const attempts = [];
    const handleSingleModel = vi.fn(async (body, model) => {
      attempts.push(model);
      return response(503, { error: { message: "overloaded" } });
    });

    await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["a/1", "b/2", "c/3"],
      handleSingleModel,
      log,
      comboName: "cooldown-bound-test",
      comboStrategy: "fallback",
      autoSwitch: false,
    });

    // 3 candidates => at most 2 inter-candidate waits, each capped at 5000ms.
    expect(attempts).toEqual(["a/1", "b/2", "c/3"]);
    expect(Date.now() - startedAt).toBeLessThanOrEqual(2 * 5000 + 2000);
  }, 20000);

  it("does not advance on a non-retryable client error", async () => {
    const attempts = [];
    const handleSingleModel = vi.fn(async (body, model) => {
      attempts.push(model);
      return response(400, { error: { message: "bad request" } });
    });

    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["a/1", "b/2"],
      handleSingleModel,
      log,
      comboName: "non-retryable-test",
      comboStrategy: "fallback",
      autoSwitch: false,
    });

    expect(attempts).toEqual(["a/1"]);
    expect(result.ok).toBe(false);
  });
});
