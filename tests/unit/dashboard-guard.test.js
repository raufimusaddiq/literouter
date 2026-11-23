import { describe, it, expect, beforeEach } from "bun:test";
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

const { guard, __test__ } = await import("../../src/server/guard.js");
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

function withMethod(req, method) {
  req.method = method;
  return req;
}

function localRequest(pathname, headers = {}, peerIp = "127.0.0.1") {
  return request(pathname, headers, peerIp);
}

describe("dashboard guard public LLM API access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("allows loopback public LLM API without API key", async () => {
    const response = await guard(localRequest("/v1/chat/completions", { host: "localhost:20128" }));

    expect(response).toBeNull();
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("rejects remote Host-spoof when real peer IP is non-loopback", async () => {
    const response = await guard(localRequest("/v1/chat/completions", { host: "localhost" }, "10.204.111.34"));

    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toBe("API key required for remote API access");
  });

  it("allows loopback peer IP regardless of Host", async () => {
    const response = await guard(localRequest("/v1/chat/completions", { host: "localhost:20128" }, "127.0.0.1"));

    expect(response).toBeNull();
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("shapes the auth error for the route's protocol", async () => {
    const claude = await guard(request("/v1/messages", { host: "router.example.com" }));
    expect(claude.status).toBe(401);
    expect(await claude.json()).toEqual({ type: "error", error: { type: "authentication_error", message: "API key required for remote API access" } });

    const gemini = await guard(request("/v1beta/models/x:generateContent", { host: "router.example.com" }));
    expect((await gemini.json()).error).toMatchObject({ code: 401, status: "UNAUTHENTICATED" });
  });

  it.each([
    ["rejects remote rewritten public LLM API without API key", "/api/v1/chat/completions"],
    ["rejects remote beta public LLM API without API key", "/v1beta/models"],
    ["rejects remote rewritten beta public LLM API without API key", "/api/v1beta/models"],
    ["rejects remote codex rewrite without API key", "/codex/x"],
    ["rejects remote /responses rewrite without API key", "/responses"],
  ])("%s", async (_label, path) => {
    const response = await guard(request(path, { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toBe("API key required for remote API access");
  });

  it("allows loopback rewritten public LLM API without API key", async () => {
    const response = await guard(localRequest("/api/v1/chat/completions", { host: "localhost:20128" }));

    expect(response).toBeNull();
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it.each([
    ["allows remote /responses rewrite with a valid API key", "/responses", { authorization: "Bearer sk-valid" }],
    ["allows remote codex rewrite with valid API key", "/codex/x", { authorization: "Bearer sk-valid" }],
    ["allows remote public LLM API with valid bearer API key", "/api/v1/chat/completions", { authorization: "Bearer sk-valid" }],
    ["allows remote public LLM API with valid x-api-key", "/v1/responses", { "x-api-key": "sk-valid" }],
    ["allows remote rewritten beta public LLM API with valid API key", "/api/v1beta/models", { "x-api-key": "sk-valid" }],
    ["allows remote beta public LLM API with valid Google API key header", "/v1beta/models", { "x-goog-api-key": "sk-valid" }],
    ["allows remote beta public LLM API with valid Google key query parameter", "/v1beta/models?key=sk-valid", {}],
  ])("%s", async (_label, path, headers) => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await guard(request(path, { host: "router.example.com", ...headers }));

    expect(response).toBeNull();
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("keeps /v1/systemone behind API-key auth for remote callers", async () => {
    const response = await guard(request("/v1/systemone", {
      host: "router.example.com",
      "content-type": "application/json",
    }));

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.message).toBe("API key required for remote API access");
    expect(body.error.type).toBe("authentication_error");
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("allows remote /v1/systemone with a valid LiteRouter API key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await guard(request("/v1/systemone", {
      host: "router.example.com",
      authorization: "Bearer sk-valid",
    }));

    expect(response).toBeNull();
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("does not expose /v1/systemone to unauthenticated dashboard callers", async () => {
    const response = await guard(request("/v1/systemone", { host: "localhost:20128" }));

    expect(response.status).toBe(401);
  });

  it("allows the same-origin dashboard workspace with a valid API key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await guard(request("/v1/systemone", {
      host: "ai.musaddiqr.com",
      origin: "https://ai.musaddiqr.com",
      authorization: "Bearer sk-valid",
    }));

    expect(response).toBeNull();
  });
});

describe("dashboard guard local-only routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    mocks.validateApiKey.mockResolvedValue(false);
  });

  it.each([
    ["get", "/api/pxpipe/install"],
    ["post", "/api/pxpipe/start"],
    ["post", "/api/headroom/extras"],
    ["delete", "/api/headroom/extras"],
    ["post", "/api/headroom/restart"],
    ["post", "/api/headroom/start"],
  ])("returns 403 for a remote %p %p even with requireLogin=false", async (method, pathname) => {
    const response = await guard(withMethod(request(pathname, { host: "router.example.com" }), method.toUpperCase()));

    expect(response.status).toBe(403);
  });

  it("keeps the extras read available to an authenticated remote dashboard", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);

    for (const method of ["GET", "HEAD"]) {
      const response = await guard(withMethod(request("/api/headroom/extras", { host: "router.example.com" }), method));
      expect(response).toBeNull();
    }
  });

  it("allows a local caller with dashboard auth", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);

    const response = await guard(withMethod(localRequest("/api/pxpipe/install"), "POST"));

    expect(response).toBeNull();
  });
});

describe("dashboard guard helpers", () => {
  beforeEach(() => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("always protects API key management when dashboard login is disabled", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await guard(request("/api/keys", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("extracts bearer API keys before x-api-key", () => {
    const apiRequest = request("/v1/chat/completions", {
      authorization: "Bearer bearer-key",
      "x-api-key": "header-key",
    });

    expect(__test__.extractApiKey(apiRequest)).toBe("bearer-key");
  });

  it("extracts Google API keys after x-api-key", () => {
    const apiRequest = request("/v1beta/models?key=query-key", {
      "x-api-key": "header-key",
      "x-goog-api-key": "google-key",
    });

    expect(__test__.extractApiKey(apiRequest)).toBe("header-key");
  });
});
