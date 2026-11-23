import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(),
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
}));

const { handleStreamingResponse } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");
const { createStreamController } = await import("../../open-sse/utils/streamHandler.js");

const base = (providerResponse, extra = {}) => ({
  providerResponse, provider: "openai", model: "m", sourceFormat: "openai", targetFormat: "openai",
  userAgent: "", body: { messages: [] }, stream: true, requestStartTime: Date.now(), connectionId: "c1",
  clientRawRequest: {}, reqLogger: null, toolNameMap: null, customToolNames: null,
  streamController: createStreamController({ provider: "openai", model: "m" }),
  streamDetailId: "d1", reqTag: "t", ...extra,
});

const sse = (chunks) => new Response(new ReadableStream({
  start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); },
}), { status: 200, headers: { "content-type": "text/event-stream" } });

describe("non-SSE 200", () => {
  it("HTML page -> 502 error result with content-type in message; no success reported", async () => {
    const onRequestSuccess = vi.fn();
    const r = await handleStreamingResponse(base(
      new Response("<html><title>Gateway oops</title></html>", { status: 200, headers: { "content-type": "text/html" } }),
      { onRequestSuccess },
    ));
    expect(r.success).toBe(false);
    expect(r.status).toBe(502);
    expect(r.error).toContain("text/html");
    expect(r.error).toContain("Gateway oops");
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("login page -> 401 (account scope)", async () => {
    const r = await handleStreamingResponse(base(
      new Response("<html><title>Sign in</title></html>", { status: 200, headers: { "content-type": "text/html" } }),
    ));
    expect(r.status).toBe(401);
  });
});

describe("onRequestSuccess timing", () => {
  it("not at stream start; fires once the stream completes", async () => {
    const onRequestSuccess = vi.fn();
    const onStreamComplete = vi.fn();
    const r = await handleStreamingResponse(base(
      sse(['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', "data: [DONE]\n\n"]),
      { onRequestSuccess, onStreamComplete },
    ));
    expect(r.success).toBe(true);
    expect(onRequestSuccess).not.toHaveBeenCalled();
    await r.response.text();
    await new Promise((res) => setTimeout(res, 10));
    expect(onStreamComplete).toHaveBeenCalled();
    expect(onRequestSuccess).toHaveBeenCalledTimes(1);
  });

  it("a stream that errors mid-way never reports success", async () => {
    const onRequestSuccess = vi.fn();
    const broken = new Response(new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
        c.error(new Error("socket reset"));
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
    const r = await handleStreamingResponse(base(broken, { onRequestSuccess, onStreamComplete: vi.fn(), onStreamAbort: vi.fn() }));
    await r.response.text().catch(() => {});
    await new Promise((res) => setTimeout(res, 10));
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });
});
