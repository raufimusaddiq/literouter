import { describe, it, expect, vi, beforeEach } from "vitest";

// The OpenAI/Anthropic "compatible" branches fetch a node-supplied baseUrl
// server-side. A remote caller must not be able to aim that fetch at an
// internal address (CodeQL js/request-forgery on providers/validate).

const { getNodeMock } = vi.hoisted(() => ({ getNodeMock: vi.fn() }));
vi.mock("@/models", () => ({ getProviderNodeById: getNodeMock }));

const fetched = [];
vi.stubGlobal("fetch", async (url) => {
  fetched.push(String(url));
  return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) };
});

const { POST } = await import("../../src/app/api/providers/validate/route.js");

function request(body, { local = false } = {}) {
  return new Request("http://127.0.0.1:20128/api/providers/validate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // custom-server.js stamps this when headers came through a reverse proxy
      ...(local
        ? { "x-9r-peer-token": "test-peer", "x-9r-real-ip": "127.0.0.1" }
        : { "x-9r-via-proxy": "1" }),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/providers/validate SSRF guard", () => {
  beforeEach(() => {
    process.env.NINEROUTER_PEER_TOKEN = "test-peer";
    fetched.length = 0;
    getNodeMock.mockReset();
  });

  it("rejects an internal baseUrl for a proxied (remote) caller without fetching it", async () => {
    getNodeMock.mockResolvedValue({ baseUrl: "http://169.254.169.254/latest/meta-data", defaultModel: "m" });

    const res = await POST(request({ provider: "openai-compatible-test", apiKey: "k" }));

    expect(res.status).toBe(400);
    expect(fetched).toEqual([]);
  });

  it("rejects a loopback baseUrl for a proxied caller", async () => {
    getNodeMock.mockResolvedValue({ baseUrl: "http://127.0.0.1:8787", defaultModel: "m" });

    const res = await POST(request({ provider: "anthropic-compatible-test", apiKey: "k" }));

    expect(res.status).toBe(400);
    expect(fetched).toEqual([]);
  });

  it("still allows a public baseUrl", async () => {
    getNodeMock.mockResolvedValue({ baseUrl: "https://api.example.com", defaultModel: "m" });

    const res = await POST(request({ provider: "openai-compatible-test", apiKey: "k" }));

    expect(res.status).toBe(200);
    expect(fetched).toEqual(["https://api.example.com/models"]);
  });

  it("rejects a metadata azureEndpoint for a proxied caller", async () => {
    const res = await POST(request({
      provider: "azure",
      apiKey: "k",
      providerSpecificData: { azureEndpoint: "http://169.254.169.254" },
    }));

    expect(res.status).toBe(400);
    expect(fetched).toEqual([]);
  });

  it("rejects a loopback ollama-local baseUrl for a proxied caller", async () => {
    const res = await POST(request({
      provider: "ollama-local",
      apiKey: "k",
      providerSpecificData: { baseUrl: "http://127.0.0.1:11434" },
    }));

    expect(res.status).toBe(400);
    expect(fetched).toEqual([]);
  });

  it("keeps allowing a private self-hosted target for a local operator", async () => {
    const res = await POST(request({
      provider: "ollama-local",
      apiKey: "k",
      providerSpecificData: { baseUrl: "http://127.0.0.1:11434" },
    }, { local: true }));

    expect(res.status).toBe(200);
    expect(fetched).toEqual(["http://127.0.0.1:11434/api/tags"]);
  });
});
