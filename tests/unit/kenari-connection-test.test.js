
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getProviderConnectionById = vi.fn();
const updateProviderConnection = vi.fn(async () => ({}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById,
  updateProviderConnection,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
  })),
}));

const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");

function kenariConnection(overrides = {}) {
  return {
    id: "conn-kenari",
    provider: "kenari",
    authType: "apikey",
    apiKey: "kn-test-key",
    providerSpecificData: {},
    ...overrides,
  };
}

describe("testSingleConnection — kenari connection test", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    getProviderConnectionById.mockReset();
    updateProviderConnection.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates against the auth-gated quota endpoint, not the auth-blind /v1/models", async () => {
    getProviderConnectionById.mockResolvedValue(kenariConnection());
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const result = await testSingleConnection("conn-kenari");

    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://kenari.id/v1/account/quota");
    expect(url).not.toContain("/v1/models");
    expect(init.headers.Authorization).toBe("Bearer kn-test-key");
  });

  it("rejects a revoked key on 401 instead of reporting the provider unsupported", async () => {
    getProviderConnectionById.mockResolvedValue(kenariConnection());
    fetchMock.mockResolvedValue({ ok: false, status: 401 });

    const result = await testSingleConnection("conn-kenari");

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid API key");
    expect(result.error).not.toMatch(/not supported/);
  });

  it("reports a non-auth HTTP failure distinctly", async () => {
    getProviderConnectionById.mockResolvedValue(kenariConnection());
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    const result = await testSingleConnection("conn-kenari");

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/HTTP 503/);
  });

  it("leaves an already-handled provider on its own endpoint", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "conn-deepseek",
      provider: "deepseek",
      authType: "apikey",
      apiKey: "ds-test-key",
      providerSpecificData: {},
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const result = await testSingleConnection("conn-deepseek");

    expect(result.valid).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.deepseek.com/models");
  });
});
