// #4333: "Strict Proxy" did not hold. With a strict pool assigned and every
// proxy in it dead, requests still went out over the direct IP — the exact
// leak the setting exists to prevent.
//
// Two halves, one per layer:
//
// 1. resolveConnectionProxyConfig drops strictProxy whenever the pool is not
//    usable (inactive, or saved with an empty proxyUrl). isValidPool gates the
//    only two returns that carry strictProxy, so an unusable strict pool falls
//    through to the legacy/none branches, which report strictProxy:false.
//
// 2. proxyAwareFetch only honours strictProxy inside the catch of a proxy
//    attempt. When no proxy URL resolves there is nothing to try, so it
//    reaches the trailing `return originalFetch(url, options)` and connects
//    directly.
import { afterAll, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;
const networkFetch = vi.fn().mockRejectedValue(new Error("network stub"));
globalThis.fetch = networkFetch;
for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
  vi.stubEnv(name, "");
}
vi.resetModules();
afterAll(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

vi.mock("@/models", () => ({
  getProxyPoolById: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => [{
    id: "strict-connection",
    apiKey: "test-key",
    providerSpecificData: { proxyPoolId: "p1" },
  }]),
  getSettings: vi.fn(async () => ({
    requireApiKey: true,
    providerStrategies: { opencode: { proxyPoolId: "p1" } },
  })),
  getProxyPools: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(async () => true),
}));

vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: vi.fn(async (model) => ({ provider: model.split("/")[0], model: "gpt-4.1" })),
  getComboModels: vi.fn(async () => null),
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: vi.fn(),
}));

vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: vi.fn() }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    execute: async ({ proxyOptions }) => {
      await proxyAwareFetch("https://api.example.com/v1/chat", {}, proxyOptions);
      throw new Error("Unexpected network access");
    },
  }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { getProxyPoolById } = await import("@/models");
const { resolveConnectionProxyConfig } = await import("../../src/lib/network/connectionProxy.js");
const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { handleChat } = await import("../../src/sse/handlers/chat.js");

describe("chat credential lookup failures", () => {
  it.each(["openai", "opencode"])("returns 503 without network access for %s", async (provider) => {
    getProxyPoolById.mockRejectedValueOnce(new Error("DB unavailable"));
    networkFetch.mockClear();
    const response = await handleChat(new Request("http://localhost/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-key" },
      body: JSON.stringify({ model: `${provider}/gpt-4.1`, messages: [{ role: "user", content: "hello" }] }),
    }));
    expect(response.status).toBe(503);
    expect((await response.json()).error.message).toBe(`Credentials unavailable for provider: ${provider}`);
    expect(networkFetch).not.toHaveBeenCalled();
  });
});

describe("strict pool policy reaches inference from credential selection", () => {
  it.each([
    ["deleted", null],
    ["inactive", { isActive: false, proxyUrl: "http://127.0.0.1:7890", strictProxy: true }],
    ["empty", { isActive: true, proxyUrl: "", strictProxy: true }],
  ])("refuses direct inference for a %s pool", async (label, pool) => {
    getProxyPoolById.mockResolvedValue(pool);
    networkFetch.mockClear();
    const credentials = await getProviderCredentials("openai");
    expect(credentials.providerSpecificData.strictProxy).toBe(true);
    expect(credentials.providerSpecificData.connectionProxyPoolId).toBe("p1");

    const result = await handleChatCore({
      body: { messages: [{ role: "user", content: "hello" }], stream: false },
      modelInfo: { provider: "openai", model: "gpt-4.1" },
      credentials,
      connectionId: credentials.connectionId,
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      rtkEnabled: false,
      headroomEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      pxpipeEnabled: false,
    });

    expect(result.status).toBe(502);
    expect(result.error).toMatch(/strictProxy/);
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it("preserves strict pool policy for public provider credentials", async () => {
    getProxyPoolById.mockResolvedValue(null);
    const credentials = await getProviderCredentials("opencode");
    expect(credentials.id).toBe("noauth");
    expect(credentials.providerSpecificData.strictProxy).toBe(true);
    expect(credentials.providerSpecificData.connectionProxyPoolId).toBe("p1");
  });
});

describe("strict pool keeps strictProxy when the pool is unusable (#4333)", () => {
  it("keeps strictProxy for an inactive strict pool", async () => {
    getProxyPoolById.mockResolvedValue({
      id: "p1", isActive: false, proxyUrl: "http://127.0.0.1:7890", strictProxy: true,
    });
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "p1" });
    expect(cfg.strictProxy).toBe(true);
  });

  it("keeps strictProxy for a strict pool saved without a proxy url", async () => {
    getProxyPoolById.mockResolvedValue({
      id: "p2", isActive: true, proxyUrl: "", strictProxy: true,
    });
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "p2" });
    expect(cfg.strictProxy).toBe(true);
  });

  it("still reports strictProxy:false for a non-strict pool", async () => {
    getProxyPoolById.mockResolvedValue({
      id: "p3", isActive: false, proxyUrl: "http://127.0.0.1:7890", strictProxy: false,
    });
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "p3" });
    expect(cfg.strictProxy).toBe(false);
  });

  it("still reports strictProxy:false when no pool is assigned", async () => {
    const cfg = await resolveConnectionProxyConfig({});
    expect(cfg.strictProxy).toBe(false);
  });

  it("fails closed when an assigned pool was deleted", async () => {
    getProxyPoolById.mockResolvedValue(null);
    const config = await resolveConnectionProxyConfig({ proxyPoolId: "deleted" });
    expect(config.source).toBe("missing-pool");
    expect(config.strictProxy).toBe(true);
    await expect(proxyAwareFetch("https://api.example.com", {}, config)).rejects.toThrow(/strictProxy/);
  });

  it("fails closed when the pool lookup fails", async () => {
    getProxyPoolById.mockRejectedValueOnce(new Error("DB unavailable"));
    await expect(resolveConnectionProxyConfig({ proxyPoolId: "p1" })).rejects.toThrow("Proxy pool could not be resolved");
  });
});

describe("strictProxy refuses a direct connection (#4333)", () => {
  it("throws when a pool is assigned but no proxy url resolved", async () => {
    await expect(
      proxyAwareFetch("https://api.example.com/v1/chat", {}, { proxyPoolId: "p1", strictProxy: true }),
    ).rejects.toThrow(/strictProxy/);
  });

  it("throws when the pool is enabled but carries an empty url", async () => {
    await expect(
      proxyAwareFetch("https://api.example.com/v1/chat", {}, { enabled: true, url: "", strictProxy: true }),
    ).rejects.toThrow(/strictProxy/);
  });

  it("does not block a caller that sets strictProxy with no proxy configured", async () => {
    // The Qoder executor passes strictProxy:true to mean "do not replay this
    // request directly if the proxy fails" — a replayed COSY signature gets a
    // 403. With nothing configured it must still reach the network.
    await expect(
      proxyAwareFetch("https://nonexistent.invalid/v1/chat", {}, { strictProxy: true }),
    ).rejects.not.toThrow(/strictProxy/);
  });

  it("does not block a request when strictProxy is off", async () => {
    // No proxy, not strict: the call is allowed to reach the network layer.
    // It fails on DNS here, which is fine — what matters is that the refusal
    // is NOT the strictProxy guard.
    await expect(
      proxyAwareFetch("https://nonexistent.invalid/v1/chat", {}, { strictProxy: false }),
    ).rejects.not.toThrow(/strictProxy/);
  });
});
