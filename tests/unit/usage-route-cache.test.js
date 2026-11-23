import { describe, it, expect, beforeEach } from "bun:test";
import { vi } from "#test/vi";

const getUsage = vi.fn();
vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(async (id) => ({ id, provider: "glm", authType: "apikey" })),
  updateProviderConnection: vi.fn(),
}));
vi.mock("open-sse/services/usage.js", () => ({ getUsageForProvider: (...a) => getUsage(...a) }));
vi.mock("open-sse/services/tokenRefresh.js", () => ({ isUnrecoverableRefreshError: () => false }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: () => ({}) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({}) }));
vi.mock("@/shared/constants/providers", () => ({ USAGE_APIKEY_PROVIDERS: ["glm"] }));

const call = async (id, qs = "") => {
  const { GET } = await import("@/app/api/usage/[connectionId]/route.js");
  const res = await GET(new Request(`http://x/api/usage/${id}${qs}`), { params: Promise.resolve({ connectionId: id }) });
  return { status: res.status, body: await res.json() };
};

describe("/api/usage/[connectionId] cache", () => {
  beforeEach(() => { getUsage.mockReset(); getUsage.mockResolvedValue({ quotas: { a: 1 } }); vi.resetModules(); });

  it("serves repeat calls from cache, per connection", async () => {
    await call("c1"); await call("c1"); await call("c2");
    expect(getUsage).toHaveBeenCalledTimes(2);
  });
  it("?force=1 bypasses the cache", async () => {
    await call("c1"); await call("c1", "?force=1");
    expect(getUsage).toHaveBeenCalledTimes(2);
  });
  it("does not cache upstream errors", async () => {
    getUsage.mockRejectedValue(new Error("boom"));
    expect((await call("c1")).status).toBe(500);
    getUsage.mockResolvedValue({ quotas: {} });
    expect((await call("c1")).status).toBe(200);
    expect(getUsage).toHaveBeenCalledTimes(2);
  });
  it("returns 504 when upstream hangs past the timeout", async () => {
    await import("@/app/api/usage/[connectionId]/route.js");
    vi.useFakeTimers();
    getUsage.mockImplementation(() => new Promise(() => {}));
    const p = call("c1");
    for (let i = 0; i < 1_500_000 && getUsage.mock.calls.length === 0; i++) {
      await new Promise((r) => setImmediate(r));
    }
    expect(getUsage).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(13_000);
    const r = await p;
    vi.useRealTimers();
    expect(r.status).toBe(504);
  });
});
