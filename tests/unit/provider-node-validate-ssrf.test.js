import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { lookupMock, fetchMock } = vi.hoisted(() => ({ lookupMock: vi.fn(), fetchMock: vi.fn() }));
vi.mock("node:dns", () => ({
  default: { promises: { lookup: lookupMock } },
  promises: { lookup: lookupMock },
}));
vi.stubGlobal("fetch", fetchMock);

const { POST } = await import("../../src/app/api/provider-nodes/validate/route.js");

function request(baseUrl) {
  return new Request("http://localhost/api/provider-nodes/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseUrl, apiKey: "k", type: "openai-compatible" }),
  });
}

describe("POST /api/provider-nodes/validate SSRF guard", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  });

  // The peer token is a per-process secret; leaking it into sibling test files
  // would make every remote caller in them look like the local operator.
  afterEach(() => {
    delete process.env.NINEROUTER_PEER_TOKEN;
  });

  it("does not fetch a private provider node", async () => {
    const res = await POST(request("http://169.254.169.254/latest/meta-data"));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fetch a hostname that resolves to a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.7", family: 4 }]);

    const res = await POST(request("http://10.0.0.7.nip.io:1234/v1"));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps allowing a LAN node for the local operator", async () => {
    process.env.NINEROUTER_PEER_TOKEN = "test-peer";
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) });

    const local = new Request("http://localhost/api/provider-nodes/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-9r-peer-token": "test-peer",
        "x-9r-real-ip": "127.0.0.1",
      },
      body: JSON.stringify({ baseUrl: "http://192.168.1.50:1234/v1", apiKey: "k", type: "openai-compatible" }),
    });

    const res = await POST(local);

    // 200 pins the contract: a 500 from a throwing guard would satisfy `not.toBe(400)`.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("does not follow a public URL redirect to an internal host", async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 302,
      headers: new Headers({ location: "http://169.254.169.254/" }),
      json: async () => ({}),
    }));

    const res = await POST(request("https://api.example.com/v1"));

    expect(res.status).not.toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // `allowPrivate` is a per-hop decision, not a one-time gate: a LAN node that
  // 30x-redirects inside the LAN must still be reachable by the local operator.
  it("lets the local operator follow a redirect between LAN hosts", async () => {
    process.env.NINEROUTER_PEER_TOKEN = "test-peer";
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 302,
        headers: new Headers({ location: "http://192.168.1.51:1234/v1/models" }),
        json: async () => ({}),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), json: async () => ({ data: [] }) });

    const res = await POST(
      new Request("http://localhost/api/provider-nodes/validate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-9r-peer-token": "test-peer",
          "x-9r-real-ip": "127.0.0.1",
        },
        body: JSON.stringify({
          baseUrl: "http://192.168.1.50:1234/v1",
          apiKey: "k",
          type: "openai-compatible",
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
