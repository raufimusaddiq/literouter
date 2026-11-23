import { describe, it, expect, beforeEach, spyOn } from "bun:test";
import { vi } from "#test/vi";
import { useTempDataDirAtLoad } from "#test/tempDataDir";

useTempDataDirAtLoad("9r-node-validate-errors-");

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.stubGlobal("fetch", fetchMock);

const { POST } = await import("../../src/app/api/provider-nodes/validate/route.js");
const { setRequestContext } = await import("../../src/server/context.js");
const { buildRequestContext } = await import("../../src/server/trust.js");

function validate(body) {
  const req = new Request("http://localhost/api/provider-nodes/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseUrl: "http://192.168.1.50:1234/v1", apiKey: "k", type: "openai-compatible", ...body }),
  });
  setRequestContext(req, buildRequestContext("127.0.0.1", req.headers));
  return POST(req);
}

const reply = (status) => ({ ok: status < 400, status, headers: new Headers(), json: async () => ({}) });

describe("POST /api/provider-nodes/validate error mapping", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    spyOn(console, "error").mockImplementation(() => {});
  });

  it.each([
    [401, "API key unauthorized"],
    [403, "API key unauthorized"],
    [404, "/models endpoint not found - try chat validation with model ID"],
    [500, "Server error - try again later"],
    [502, "Server error - try again later"],
    [418, "Unexpected response (418)"],
  ])("/models answering HTTP %i reports %p", async (status, error) => {
    fetchMock.mockResolvedValue(reply(status));

    const res = await validate({});

    expect(await res.json()).toEqual({ valid: false, error });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, "Invalid model or bad request"],
    [404, "Chat endpoint not found"],
    [503, "Server error - try again later"],
    [429, "Chat request failed (429)"],
  ])("chat fallback answering HTTP %i reports %p", async (status, error) => {
    fetchMock.mockResolvedValueOnce(reply(404)).mockResolvedValueOnce(reply(status));

    const res = await validate({ modelId: "m" });

    expect(await res.json()).toEqual({ valid: false, error, method: "chat" });
    expect(String(fetchMock.mock.calls[1][0])).toBe("http://192.168.1.50:1234/v1/chat/completions");
  });

  it("accepts the key when the chat fallback succeeds", async () => {
    fetchMock.mockResolvedValueOnce(reply(404)).mockResolvedValueOnce(reply(200));

    const res = await validate({ modelId: "m" });

    expect(await res.json()).toEqual({ valid: true, method: "chat" });
  });

  it.each([
    ["ECONNREFUSED", "connect failed", "Connection refused - provider node offline or unreachable"],
    ["ENOTFOUND", "getaddrinfo failed", "DNS lookup failed - invalid domain or network issue"],
    ["ETIMEDOUT", "connect failed", "Connection timeout - provider node too slow"],
    ["CERT_HAS_EXPIRED", "tls failed", "SSL certificate expired"],
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "tls failed", "SSL certificate verification failed"],
    ["EPIPE", "write failed", "Network error: EPIPE"],
    [undefined, "Request timeout", "Request timeout (>10s) - provider node not responding"],
    [undefined, "boom", "Network connection failed - check URL and network connectivity"],
  ])("a fetch failure with cause %p and message %p reports %p", async (code, message, error) => {
    fetchMock.mockRejectedValue(new Error(message, { cause: code ? { code } : undefined }));

    const res = await validate({});

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ valid: false, error });
  });

  it("rejects a malformed base URL before fetching", async () => {
    const res = await validate({ baseUrl: "not-a-url" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid URL format" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
