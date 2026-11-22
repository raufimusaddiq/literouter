import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = vi.hoisted(() => ({
  refresh: vi.fn(),
  updateConn: vi.fn(async () => ({ id: "c1" })),
  fetch: vi.fn(),
}));

vi.mock("@/lib/db/index.js", () => ({
  getProviderConnectionById: async () => null,
  updateProviderConnection: fx.updateConn,
}));
vi.mock("open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: vi.fn(),
  invalidateProjectId: vi.fn(),
}));
vi.mock("open-sse/services/tokenRefresh.js", async (importOriginal) => ({
  ...(await importOriginal()),
  refreshTokenByProvider: fx.refresh,
}));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fx.fetch(...args),
}));

const { checkAndRefreshToken } = await import("../../src/sse/services/tokenRefresh.js");
const { BaseExecutor } = await import("../../open-sse/executors/base.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("proactive token refresh", () => {
  it("N concurrent waiters on one refresh cause exactly one credential write", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    fx.refresh.mockImplementation(async () => {
      await gate;
      return { accessToken: "new-token", refreshToken: "new-refresh", expiresIn: 3600 };
    });
    const stale = () => ({
      connectionId: "c1",
      accessToken: "old",
      refreshToken: "old-refresh",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const calls = Array.from({ length: 6 }, () => checkAndRefreshToken("claude", stale()));
    await new Promise((r) => setTimeout(r, 5));
    release();
    const results = await Promise.all(calls);

    expect(fx.refresh).toHaveBeenCalledTimes(1);
    expect(fx.updateConn).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r.accessToken).toBe("new-token");
  });
});

describe("upstream 504", () => {
  it("produces exactly one upstream fetch (never replayed)", async () => {
    fx.fetch.mockResolvedValue({ status: 504, headers: { get: () => "" } });
    const ex = new BaseExecutor("test", { baseUrl: "https://x/api" });
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: { apiKey: "k" } });
    expect(out.response.status).toBe(504);
    expect(fx.fetch).toHaveBeenCalledTimes(1);
  });
});
