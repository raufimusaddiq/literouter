import { describe, it, expect, beforeEach } from "bun:test";
import { vi } from "#test/vi";

const fx = vi.hoisted(() => ({
  chatCore: vi.fn(),
  getCreds: vi.fn(),
  conns: new Map(),
  patches: [],
}));

vi.mock("@/lib/db/index.js", async () => ({
  ...(await import("@/lib/db/index.js?actual")),
  getSettings: async () => ({ requireApiKey: false, comboStrategy: "fallback" }),
  getModelAliases: async () => ({}),
  getComboByName: async () => null,
  getProviderNodes: async () => [],
  getCombos: async () => [],
  getProviderConnections: async () => [],
  getProviderConnectionById: async (id) => fx.conns.get(id) || null,
  getCustomModels: async () => [],
  validateApiKey: async () => true,
  getProxyPools: async () => [],
  mutateProviderConnection: async (id, mutate) => {
    const existing = fx.conns.get(id);
    if (!existing) return null;
    const patch = mutate(existing);
    if (!patch) return null;
    fx.patches.push(patch);
    const merged = { ...existing, ...patch };
    fx.conns.set(id, merged);
    return merged;
  },
  updateProviderConnection: async (id, patch) => {
    fx.patches.push(patch);
    fx.conns.set(id, { ...fx.conns.get(id), ...patch });
    return fx.conns.get(id);
  },
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/lib/db/repos/combosRepo.js", async () => ({
  ...(await import("@/lib/db/repos/combosRepo.js?actual")), getCombos: async () => [] }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", async () => ({
  ...(await import("@/lib/db/repos/apiKeysRepo.js?actual")), getApiKeyByKey: async () => null }));
vi.mock("@/lib/usageDb.js", async () => ({
  ...(await import("@/lib/usageDb.js?actual")),
  saveRequestUsage: vi.fn(),
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: async (_p, c) => c,
  updateProviderCredentials: vi.fn(),
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: fx.chatCore }));
vi.mock("@/lib/network/connectionProxy", () => ({ pickProxyPoolId: vi.fn(), resolveConnectionProxyConfig: vi.fn() }));
vi.mock("../../src/sse/services/auth.js", async () => ({
  ...(await import("../../src/sse/services/auth.js?actual")),
  getProviderCredentials: fx.getCreds,
}));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: async (m) => ({ provider: "openai", model: m.split("/").pop() }),
  getComboModels: async () => null,
}));

const { handleChat } = await import("../../src/sse/handlers/chat.js");
const { markAccountUnavailable, clearAccountError } = await import("../../src/sse/services/auth.js");
const { checkFallbackError, shouldRotateAccount } = await import("../../open-sse/services/accountFallback.js");
const { createErrorResult } = await import("../../open-sse/utils/error.js");
const { handleComboChat } = await import("../../open-sse/services/combo.js");

const chatReq = () =>
  new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "openai/gpt-x", messages: [{ role: "user", content: "hi" }] }),
  });

const quietLog = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks();
  fx.patches.length = 0;
  fx.conns.clear();
  for (const id of ["c1", "c2"]) fx.conns.set(id, { id, provider: "openai", name: id, testStatus: "active", backoffLevel: 0 });
  fx.getCreds.mockImplementation(async (_p, excluded) => {
    const id = ["c1", "c2"].find((c) => !excluded.has(c));
    return id ? { connectionId: id, connectionName: id } : null;
  });
});

describe("error-rule scope classification", () => {
  it.each([
    [400, "This model's maximum context length is 8192 tokens", "model", true],
    [400, "context_length_exceeded", "model", true],
    [400, "Improperly formed request.", "request", false],
    [400, "content_policy_violation: blocked", "request", false],
    [400, "something the caller got wrong", "request", false],
    [422, "invalid field", "request", false],
    [401, "bad key", "account", true],
    [429, "slow down", "account", true],
    [503, "upstream exploded", "account", true],
    [400, "rate limit reached", "account", true],
  ])("%i %s -> scope=%s combo-fallback=%s", (status, text, scope, comboFallback) => {
    const r = checkFallbackError(status, text);
    expect(r.scope).toBe(scope);
    expect(r.shouldFallback).toBe(comboFallback);
    expect(shouldRotateAccount(r)).toBe(scope === "account");
  });
});

describe("request-scoped errors skip failover", () => {
  it.each([
    ["Kiro improperly formed request", "Improperly formed request."],
    ["context overflow", "This model's maximum context length is 8192 tokens"],
  ])("%s: executor called once, no lock/testStatus write, error returned", async (_n, msg) => {
    fx.chatCore.mockResolvedValue(createErrorResult(400, msg));
    const res = await handleChat(chatReq());
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain(msg);
    expect(fx.chatCore).toHaveBeenCalledTimes(1);
    expect(fx.patches).toEqual([]);
    expect(fx.conns.get("c1").testStatus).toBe("active");
  });

  it("account-scoped 401 still locks and rotates to the next account", async () => {
    fx.chatCore
      .mockResolvedValueOnce(createErrorResult(401, "bad key"))
      .mockResolvedValueOnce({ success: true, response: new Response("ok") });
    const res = await handleChat(chatReq());
    expect(res.status).toBe(200);
    expect(fx.chatCore).toHaveBeenCalledTimes(2);
    expect(fx.patches).toHaveLength(1);
    expect(fx.conns.get("c1").testStatus).toBe("unavailable");
  });

  it("combo: context overflow (model scope) moves to the next, larger model", async () => {
    const calls = [];
    const handleSingleModel = vi.fn(async (_b, m) => {
      calls.push(m);
      if (m === "openai/small") {
        return new Response(JSON.stringify({ error: { message: "maximum context length is 8192 tokens" } }), { status: 400 });
      }
      return new Response("{}", { status: 200 });
    });
    const res = await handleComboChat({
      body: { messages: [] }, models: ["openai/small", "openai/big"], handleSingleModel,
      log: quietLog(), comboName: "t36-ctx", comboStrategy: "fallback",
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["openai/small", "openai/big"]);
  });

  it("combo: request-scope error is returned, not replayed on other members", async () => {
    const handleSingleModel = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "Improperly formed request." } }), { status: 400 }));
    const res = await handleComboChat({
      body: { messages: [] }, models: ["kiro/a", "kiro/b"], handleSingleModel,
      log: quietLog(), comboName: "t36-req", comboStrategy: "fallback",
    });
    expect(res.status).toBe(400);
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
  });
});

describe("account health bookkeeping", () => {
  it("backoff level is derived inside the write, so repeated 429s climb 1,2,3", async () => {
    for (let i = 0; i < 3; i++) await markAccountUnavailable("c1", 429, "rate limit", "openai", "m");
    expect(fx.patches.map((p) => p.backoffLevel)).toEqual([1, 2, 3]);
  });

  it("clearAccountError makes zero writes when locks are null/absent", async () => {
    const healthy = { id: "c1", testStatus: "active", modelLock_a: null, modelLock___all: null };
    await clearAccountError("c1", healthy, "a");
    await clearAccountError("c1", { _connection: healthy }, "b");
    expect(fx.patches).toEqual([]);
  });

  it("clearAccountError clears an active lock of the succeeded model and resets health", async () => {
    const locked = { id: "c1", testStatus: "unavailable", lastError: "x", modelLock_m: new Date(Date.now() + 60_000).toISOString() };
    await clearAccountError("c1", locked, "m");
    expect(fx.patches).toHaveLength(1);
    expect(fx.patches[0]).toMatchObject({ modelLock_m: null, testStatus: "active", backoffLevel: 0 });
  });
});
