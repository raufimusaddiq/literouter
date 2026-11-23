import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/services/accountFallback.js", async () => {
  const actual = await vi.importActual("../../open-sse/services/accountFallback.js");
  return { ...actual, checkFallbackError: vi.fn(actual.checkFallbackError) };
});

import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

const DEGRADED = "Function cannot be invoked: DEGRADED";

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    clone: () => ({ json: async () => body }),
  };
}

const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), line: vi.fn() };

function runCombo(models, failStatus, failBody) {
  const attempts = [];
  const ok = response(200);
  const failure = response(failStatus, failBody);
  const handleSingleModel = vi.fn(async (body, model) => {
    attempts.push(model);
    return model === models[0] ? failure : ok;
  });
  return { attempts, ok, failure, handleSingleModel };
}

const body = { messages: [{ role: "user", content: "hi" }] };

beforeEach(() => {
  vi.mocked(checkFallbackError).mockClear();
});

describe("combo fallback passes the seat provider id to checkFallbackError", () => {
  it("applies the NVIDIA degraded rule (15m cooldown) and falls through", async () => {
    const models = ["nvidia/meta/llama-3.3-70b-instruct", "groq/llama-3.3-70b-versatile"];
    const { attempts, ok, handleSingleModel } = runCombo(models, 400, {
      error: { message: DEGRADED },
    });

    const result = await handleComboChat({
      body,
      models,
      handleSingleModel,
      log,
      comboName: "nvidia-degraded-test",
      comboStrategy: "fallback",
      autoSwitch: false,
    });

    expect(attempts).toEqual(models);
    expect(result).toBe(ok);

    const call = vi.mocked(checkFallbackError).mock.calls.at(-1);
    expect(call).toEqual([400, DEGRADED, 0, "nvidia"]);
    expect(vi.mocked(checkFallbackError).mock.results.at(-1).value).toEqual({
      shouldFallback: true,
      cooldownMs: 15 * 60 * 1000,
      scope: "account",
    });
  });

  it("leaves a non-NVIDIA provider with the same status and text unchanged", async () => {
    const models = ["groq/llama-3.3-70b-versatile", "nvidia/meta/llama-3.3-70b-instruct"];
    const { attempts, failure, handleSingleModel } = runCombo(models, 400, {
      error: { message: DEGRADED },
    });

    const result = await handleComboChat({
      body,
      models,
      handleSingleModel,
      log,
      comboName: "groq-degraded-test",
      comboStrategy: "fallback",
      autoSwitch: false,
    });

    expect(attempts).toEqual([models[0]]);
    expect(result).toBe(failure);

    const call = vi.mocked(checkFallbackError).mock.calls.at(-1);
    expect(call).toEqual([400, DEGRADED, 0, "groq"]);
    expect(vi.mocked(checkFallbackError).mock.results.at(-1).value).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
      scope: "request",
    });
  });
});
