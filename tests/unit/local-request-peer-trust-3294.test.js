import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { vi } from "#test/vi";

const mocks = vi.hoisted(() => ({
  nextResponse: Symbol("next"),
  jsonResponse: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => mocks.nextResponse),
    json: mocks.jsonResponse,
    redirect: vi.fn((url) => ({ status: 307, url })),
  },
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

const { proxy } = await import("../../src/dashboardGuard.js");
const { getClientIp } = await import("../../src/lib/auth/loginLimiter.js");

const PEER_TOKEN = "peer-token-fixture";

function request(pathname, headers = {}) {
  return {
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: new Headers(headers),
    cookies: { get: vi.fn(() => undefined) },
    url: `http://localhost${pathname}`,
  };
}

const originalNodeEnv = process.env.NODE_ENV;

describe("peer header trust", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;
    process.env.NODE_ENV = "production";
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.NINEROUTER_PEER_TOKEN;
  });

  it("rejects a spoofed loopback peer IP that carries no trust proof", async () => {
    const response = await proxy(request("/api/v1/models", {
      host: "172.18.192.1:20140",
      "x-9r-real-ip": "127.0.0.1",
    }));

    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe("API key required for remote API access");
  });

  it("rejects a spoofed loopback peer IP carrying a wrong trust token", async () => {
    const response = await proxy(request("/api/v1/models", {
      host: "172.18.192.1:20140",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-peer-token": "guessed-token",
    }));

    expect(response.status).toBe(401);
  });

  it("rejects a spoofed loopback Host in production", async () => {
    const response = await proxy(request("/api/v1/models", { host: "localhost" }));

    expect(response.status).toBe(401);
  });

  it("rejects a spoofed loopback peer IP when the wrapper never booted", async () => {
    delete process.env.NINEROUTER_PEER_TOKEN;

    const response = await proxy(request("/api/v1/models", {
      host: "172.18.192.1:20140",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-peer-token": "any-token",
    }));

    expect(response.status).toBe(401);
  });

  it("keeps serving a genuinely local request stamped by the wrapper", async () => {
    const response = await proxy(request("/api/v1/models", {
      host: "localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-peer-token": PEER_TOKEN,
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it.each(["::ffff:127.0.0.1", "::1", "[::1]", "127.0.0.1", "::FFFF:127.0.0.1"])(
    "treats %s as a loopback peer",
    async (peerIp) => {
      const response = await proxy(request("/api/v1/models", {
        host: "localhost:20128",
        "x-9r-real-ip": peerIp,
        "x-9r-peer-token": PEER_TOKEN,
      }));

      expect(response).toBe(mocks.nextResponse);
    }
  );

  it.each(["::ffff:10.204.111.34", "2001:db8::1", "[2001:db8::1]", "10.204.111.34"])(
    "refuses %s as a peer",
    async (peerIp) => {
      const response = await proxy(request("/api/v1/models", {
        host: "localhost:20128",
        "x-9r-real-ip": peerIp,
        "x-9r-peer-token": PEER_TOKEN,
      }));

      expect(response.status).toBe(401);
    }
  );

  it("still refuses a stamped non-loopback peer IP", async () => {
    const response = await proxy(request("/api/v1/models", {
      host: "localhost:20128",
      "x-9r-real-ip": "10.204.111.34",
      "x-9r-peer-token": PEER_TOKEN,
    }));

    expect(response.status).toBe(401);
  });

  it("never trusts a spoofable Host header, even in development", async () => {
    process.env.NODE_ENV = "development";

    const response = await proxy(request("/api/v1/models", { host: "localhost:20127" }));

    expect(response.status).toBe(401);
  });

  it("trusts a loopback socket once the wrapper proved it stamped the peer address", async () => {
    const response = await proxy(request("/api/v1/models", {
      host: "localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-peer-token": PEER_TOKEN,
    }));

    expect(response).toBe(mocks.nextResponse);
  });
  it("lets a remote caller through only when the mocked validateApiKey accepts the key", async () => {
    const headers = { host: "172.18.192.1:20140", authorization: "Bearer router-key" };
    mocks.validateApiKey.mockResolvedValue(true);
    expect(await proxy(request("/api/v1/models", headers))).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("router-key");

    mocks.validateApiKey.mockResolvedValue(false);
    expect((await proxy(request("/api/v1/models", headers))).status).toBe(401);
  });

  it("honours the mocked getSettings().requireLogin for local-only routes", async () => {
    const headers = { host: "localhost:20128", "x-9r-real-ip": "127.0.0.1", "x-9r-peer-token": PEER_TOKEN };
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    expect(await proxy(request("/api/headroom/start", headers))).toBe(mocks.nextResponse);

    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    expect((await proxy(request("/api/headroom/start", headers))).status).toBe(403);
  });
});

describe("login limiter client IP", () => {
  beforeEach(() => {
    process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;
    delete process.env.TRUST_PROXY;
  });

  afterEach(() => {
    delete process.env.NINEROUTER_PEER_TOKEN;
    delete process.env.TRUST_PROXY;
  });

  it("buckets spoofed peer IPs together so lockout cannot be rotated away", () => {
    const first = getClientIp(request("/api/auth/login", { "x-9r-real-ip": "1.1.1.1" }));
    const second = getClientIp(request("/api/auth/login", { "x-9r-real-ip": "2.2.2.2" }));

    expect(first).toBe("unknown");
    expect(second).toBe("unknown");
  });

  it("keys on the stamped peer IP when the wrapper proved it", () => {
    const ip = getClientIp(request("/api/auth/login", {
      "x-9r-real-ip": "203.0.113.9",
      "x-9r-peer-token": PEER_TOKEN,
    }));

    expect(ip).toBe("203.0.113.9");
  });

  it("still honours TRUST_PROXY for operators fronting 9router with a reverse proxy", () => {
    process.env.TRUST_PROXY = "true";

    const ip = getClientIp(request("/api/auth/login", { "x-forwarded-for": "198.51.100.7, 10.0.0.1" }));

    expect(ip).toBe("10.0.0.1");
  });
});
