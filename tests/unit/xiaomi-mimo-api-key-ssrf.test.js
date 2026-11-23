import { describe, it, expect, beforeEach } from "bun:test";
import { vi } from "#test/vi";
import { useTempDataDirAtLoad } from "#test/tempDataDir";

useTempDataDirAtLoad("9r-mimo-key-");

const { lookupMock, fetchMock, createMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  fetchMock: vi.fn(),
  createMock: vi.fn(),
}));
vi.mock("@/models", () => ({
  createProviderConnection: createMock,
  getProviderConnections: vi.fn(async () => []),
  updateProviderConnection: vi.fn(),
}));
vi.mock("node:dns", () => ({
  default: { promises: { lookup: lookupMock } },
  promises: { lookup: lookupMock },
}));
vi.stubGlobal("fetch", fetchMock);

const { POST } = await import("../../src/app/api/oauth/xiaomi-mimo/api-key/route.js");

function request(body, { local = false } = {}) {
  return new Request("http://127.0.0.1:20128/api/oauth/xiaomi-mimo/api-key", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(local
        ? { "x-9r-peer-token": "test-peer", "x-9r-real-ip": "127.0.0.1" }
        : { "x-9r-via-proxy": "1" }),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/oauth/xiaomi-mimo/api-key baseUrl guard", () => {
  beforeEach(() => {
    process.env.NINEROUTER_PEER_TOKEN = "test-peer";
    fetchMock.mockReset();
    createMock.mockReset();
    createMock.mockResolvedValue({ id: "c1", provider: "xiaomi-mimo", email: null, displayName: "x" });
    lookupMock.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ data: [{}, {}] }),
    });
  });

  it("rejects a non-http baseUrl", async () => {
    for (const baseUrl of ["file:///etc/passwd", "ftp://example.com", "not a url"]) {
      for (const local of [false, true]) {
        const res = await POST(request({ apiKey: "sk-abc", baseUrl }, { local }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe("baseUrl not allowed");
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a private/loopback baseUrl for remote callers", async () => {
    for (const baseUrl of ["http://127.0.0.1:8080", "http://169.254.169.254"]) {
      const res = await POST(request({ apiKey: "sk-abc", baseUrl }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("baseUrl not allowed");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("local operator may use a private host via fetchPublic allowPrivate", async () => {
    const res = await POST(request({ apiKey: "sk-abc", baseUrl: "http://127.0.0.1:8080/v1/" }, { local: true }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8080/v1/models");
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
  });

  it("remote public host is fetched through fetchPublic (manual redirect)", async () => {
    const res = await POST(request({ apiKey: "sk-abc", baseUrl: "https://api.example.com/v1" }));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
  });

  it("accepts a public https baseUrl and trims trailing slashes", async () => {
    const res = await POST(request({ apiKey: "sk-abc", baseUrl: "https://api.example.com/v1///" }));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/models");
  });

  it("default baseUrl unchanged", async () => {
    const res = await POST(request({ apiKey: "sk-abc" }));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.xiaomimimo.com/v1/models");
  });

  it("many trailing slashes trims quickly", async () => {
    const baseUrl = "https://api.example.com/v1" + "/".repeat(100000);
    const start = performance.now();
    const res = await POST(request({ apiKey: "sk-abc", baseUrl }));
    expect(performance.now() - start).toBeLessThan(100);
    expect(res.status).toBe(200);
  });
});
