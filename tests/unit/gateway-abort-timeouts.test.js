import { describe, it, expect, beforeEach } from "bun:test";
import { vi } from "#test/vi";

const fx = vi.hoisted(() => ({
  chatCore: vi.fn(),
  markUnavailable: vi.fn(async () => ({ shouldFallback: true })),
  getCreds: vi.fn(),
  pending: vi.fn(),
  fetch: vi.fn(),
  executor: { noAuth: true, execute: vi.fn() },
}));

vi.mock("@/lib/db/index.js", async () => ({
  ...(await import("../../src/lib/db/index.js?actual")),
  getSettings: async () => ({ requireApiKey: false, comboStrategy: "fallback" }),
  getModelAliases: async () => ({}),
  getComboByName: async () => null,
  getProviderNodes: async () => [],
  getCombos: async () => [],
  getProviderConnections: async () => [],
  getProviderConnectionById: async () => null,
  getCustomModels: async () => [],
  validateApiKey: async () => true,
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/lib/db/repos/combosRepo.js", async () => ({ ...(await import("../../src/lib/db/repos/combosRepo.js?actual")), getCombos: async () => [] }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", async () => ({ ...(await import("../../src/lib/db/repos/apiKeysRepo.js?actual")), getApiKeyByKey: async () => null }));
vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: vi.fn(),
  trackPendingRequest: fx.pending,
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: async (_p, c) => c,
  updateProviderCredentials: vi.fn(),
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: fx.chatCore }));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: fx.getCreds,
  markAccountUnavailable: fx.markUnavailable,
  clearAccountError: vi.fn(),
  extractApiKey: () => null,
  isValidApiKey: async () => true,
}));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: async (m) => ({ provider: "openai", model: m.split("/").pop() }),
  getComboModels: async () => null,
}));

const { handleChat } = await import("../../src/sse/handlers/chat.js");
const { createErrorResult } = await import("../../open-sse/utils/error.js");

const chatReq = (signal) =>
  new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "openai/gpt-x", messages: [{ role: "user", content: "hi" }] }),
    signal,
  });

beforeEach(() => {
  vi.clearAllMocks();
  fx.getCreds.mockResolvedValue({ connectionId: "c1", connectionName: "acc1" });
});

describe("client abort stops the account loop", () => {
  it("abort while waiting for upstream: one executor call, no lock, no fallback, 499", async () => {
    const ctrl = new AbortController();
    fx.chatCore.mockImplementation(async ({ clientRawRequest }) => {
      expect(clientRawRequest.signal).toBeTruthy();
      ctrl.abort();
      return createErrorResult(499, "Request aborted");
    });
    const res = await handleChat(chatReq(ctrl.signal));
    expect(res.status).toBe(499);
    expect(fx.chatCore).toHaveBeenCalledTimes(1);
    expect(fx.markUnavailable).not.toHaveBeenCalled();
  });

  it("already-aborted request never reaches an executor", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const res = await handleChat(chatReq(ctrl.signal));
    expect(res.status).toBe(499);
    expect(fx.chatCore).not.toHaveBeenCalled();
    expect(fx.getCreds).not.toHaveBeenCalled();
  });

  it("a thrown abort anywhere maps to 499, not an HTML 500", async () => {
    const ctrl = new AbortController();
    fx.chatCore.mockImplementation(async () => {
      ctrl.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    const res = await handleChat(chatReq(ctrl.signal));
    expect(res.status).toBe(499);
    expect(fx.markUnavailable).not.toHaveBeenCalled();
  });

  it("timeout (504) is returned as-is: no account lock, no next account", async () => {
    fx.chatCore.mockResolvedValue(createErrorResult(504, "Upstream timeout: slow"));
    const res = await handleChat(chatReq());
    expect(res.status).toBe(504);
    expect(fx.chatCore).toHaveBeenCalledTimes(1);
    expect(fx.markUnavailable).not.toHaveBeenCalled();
  });

  it("unexpected throw becomes a JSON gateway error", async () => {
    fx.chatCore.mockRejectedValue(new Error("boom"));
    const res = await handleChat(chatReq());
    expect(res.status).toBe(500);
    expect((res.headers.get("content-type") || "")).toContain("application/json");
    expect((await res.json()).error?.message).toBeTruthy();
  });
});

describe("combo", () => {
  it("abort during the cooldown sleep stops before the next member", async () => {
    const { handleComboChat } = await import("../../open-sse/services/combo.js");
    const ctrl = new AbortController();
    const calls = [];
    const handleSingleModel = vi.fn(async (_b, m) => {
      calls.push(m);
      setTimeout(() => ctrl.abort(), 20);
      return new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503, headers: { "content-type": "application/json" } });
    });
    const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const t0 = Date.now();
    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["openai/a", "openai/b"],
      handleSingleModel, log, comboName: "t35-cooldown", comboStrategy: "fallback", signal: ctrl.signal,
    });
    expect(res.status).toBe(499);
    expect(calls).toEqual(["openai/a"]);
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it("504 from the first member is returned; second member is never called", async () => {
    const { handleComboChat } = await import("../../open-sse/services/combo.js");
    const handleSingleModel = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "Upstream timeout" } }), { status: 504, headers: { "content-type": "application/json" } }));
    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["openai/a", "openai/b"], handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() }, comboName: "t35-504", comboStrategy: "fallback",
    });
    expect(res.status).toBe(504);
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
  });

  it("already-aborted signal starts no member", async () => {
    const { handleComboChat } = await import("../../open-sse/services/combo.js");
    const ctrl = new AbortController();
    ctrl.abort();
    const handleSingleModel = vi.fn();
    const res = await handleComboChat({
      body: {}, models: ["openai/a"], handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() }, comboName: "t35-pre", comboStrategy: "fallback", signal: ctrl.signal,
    });
    expect(res.status).toBe(499);
    expect(handleSingleModel).not.toHaveBeenCalled();
  });
});
