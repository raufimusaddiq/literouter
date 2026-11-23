import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { vi } from "#test/vi";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
}));

vi.mock("@/lib/db/index.js", () => ({
  getSettings: mocks.getSettings,
  validateApiKey: mocks.validateApiKey,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: mocks.verifyDashboardAuthToken,
}));

const { guard } = await import("../../src/server/guard.js");
const { getClientIp } = await import("../../src/lib/auth/loginLimiter.js");
const { setRequestContext } = await import("../../src/server/context.js");
const { buildRequestContext } = await import("../../src/server/trust.js");

function request(pathname, headers = {}, peerIp = null) {
  const req = {
    headers: new Headers(headers),
    cookies: { get: vi.fn(() => undefined) },
    url: `http://localhost${pathname}`,
  };
  if (peerIp !== null) setRequestContext(req, buildRequestContext(peerIp, req.headers));
  return req;
}

const originalNodeEnv = process.env.NODE_ENV;

describe("peer header trust", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "production";
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("a request without a server context is never local", async () => {
    const response = await guard(request("/api/v1/models", { host: "172.18.192.1:20140" }));

    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toBe("API key required for remote API access");
  });

  it("a context built from a non-loopback peer is never local", async () => {
    const response = await guard(request("/api/v1/models", { host: "172.18.192.1:20140" }, "172.18.192.1"));

    expect(response.status).toBe(401);
  });

  it("rejects a spoofed loopback Host in production", async () => {
    const response = await guard(request("/api/v1/models", { host: "localhost" }));

    expect(response.status).toBe(401);
  });

  it("a spoofed x-9r-real-ip header is ignored", async () => {
    const response = await guard(request("/api/v1/models", {
      host: "172.18.192.1:20140",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-peer-token": "any-token",
    }, "172.18.192.1"));

    expect(response.status).toBe(401);
  });

  it("a context from a real loopback peer is local", async () => {
    const response = await guard(request("/api/v1/models", { host: "localhost:20128" }, "127.0.0.1"));

    expect(response).toBeNull();
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it.each(["::ffff:127.0.0.1", "::1", "[::1]", "127.0.0.1", "::FFFF:127.0.0.1"])(
    "treats %p as a loopback peer",
    async (peerIp) => {
      const response = await guard(request("/api/v1/models", { host: "localhost:20128" }, peerIp));

      expect(response).toBeNull();
    }
  );

  it.each(["::ffff:10.204.111.34", "2001:db8::1", "[2001:db8::1]", "10.204.111.34"])(
    "refuses %p as a peer",
    async (peerIp) => {
      const response = await guard(request("/api/v1/models", { host: "localhost:20128" }, peerIp));

      expect(response.status).toBe(401);
    }
  );

  it("still refuses a stamped non-loopback peer IP", async () => {
    const response = await guard(request("/api/v1/models", { host: "localhost:20128" }, "10.204.111.34"));

    expect(response.status).toBe(401);
  });

  it("never trusts a spoofable Host header, even in development", async () => {
    process.env.NODE_ENV = "development";

    const response = await guard(request("/api/v1/models", { host: "localhost:20127" }));

    expect(response.status).toBe(401);
  });

  it("trusts a loopback socket once the server context records its peer address", async () => {
    const response = await guard(request("/api/v1/models", { host: "localhost:20128" }, "127.0.0.1"));

    expect(response).toBeNull();
  });

  it("lets a remote caller through only when the mocked validateApiKey accepts the key", async () => {
    const headers = { host: "172.18.192.1:20140", authorization: "Bearer router-key" };
    mocks.validateApiKey.mockResolvedValue(true);
    expect(await guard(request("/api/v1/models", headers))).toBeNull();
    expect(mocks.validateApiKey).toHaveBeenCalledWith("router-key");

    mocks.validateApiKey.mockResolvedValue(false);
    expect((await guard(request("/api/v1/models", headers))).status).toBe(401);
  });

  it("honours the mocked getSettings().requireLogin for local-only routes", async () => {
    const headers = { host: "localhost:20128" };
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    expect(await guard(request("/api/headroom/start", headers, "127.0.0.1"))).toBeNull();

    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    expect((await guard(request("/api/headroom/start", headers, "127.0.0.1"))).status).toBe(403);
  });
});

describe("login limiter client IP", () => {
  beforeEach(() => {
    delete process.env.TRUST_PROXY;
  });

  afterEach(() => {
    delete process.env.TRUST_PROXY;
  });

  it("buckets spoofed peer IPs together so lockout cannot be rotated away", () => {
    const first = getClientIp(request("/api/auth/login", { "x-9r-real-ip": "1.1.1.1" }));
    const second = getClientIp(request("/api/auth/login", { "x-9r-real-ip": "2.2.2.2" }));

    expect(first).toBe("unknown");
    expect(second).toBe("unknown");
  });

  it("keys on the context client IP the server derived from the socket", () => {
    const ip = getClientIp(request("/api/auth/login", {}, "203.0.113.9"));

    expect(ip).toBe("203.0.113.9");
  });

  it("still honours TRUST_PROXY for operators fronting 9router with a reverse proxy", () => {
    process.env.TRUST_PROXY = "true";

    const ip = getClientIp(request("/api/auth/login", { "x-forwarded-for": "198.51.100.7, 10.0.0.1" }));

    expect(ip).toBe("10.0.0.1");
  });
});
