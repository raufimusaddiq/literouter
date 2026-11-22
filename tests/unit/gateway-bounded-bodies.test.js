// T-35 review fixes: every body read / prefetch stays bounded, and the
// non-stream request signal is disposed once the body is consumed.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { vi } from "#test/vi";

const fx = vi.hoisted(() => ({ execute: vi.fn(), pending: vi.fn(), imageOpts: [] }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: fx.execute }),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: fx.pending,
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(),
}));
vi.mock("../../open-sse/translator/concerns/image.js", async (orig) => ({
  ...(await orig()),
  fetchImageAsBase64: vi.fn(async (url, opts) => { fx.imageOpts.push(opts); return null; }),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { readBodyBounded, GatewayTimeoutError } = await import("../../open-sse/utils/requestTimeouts.js");
const { prefetchRemoteImages } = await import("../../open-sse/translator/concerns/prefetch.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

const stalledSse = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("data: {}\n\n")); } }), {
  status: 200, headers: { "content-type": "text/event-stream" },
});
const okJson = () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), {
  status: 200, headers: { "content-type": "application/json" },
});

const base = (extra = {}) => ({
  body: { model: "x", messages: [{ role: "user", content: "hi" }], stream: false },
  modelInfo: { provider: "api-airforce", model: "m" },
  credentials: { apiKey: "k" },
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: {} },
  connectionId: "c1",
  ...extra,
});
const plain = { modelInfo: { provider: "deepseek", model: "deepseek-chat" } };

describe("bounded upstream body reads", () => {
  beforeEach(() => { vi.useFakeTimers(); fx.execute.mockReset(); fx.pending.mockReset(); });
  afterEach(() => vi.useRealTimers());

  it("readBodyBounded: stalled body -> idle GatewayTimeout and the body is cancelled", async () => {
    let cancelled = false;
    const res = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    const p = readBodyBounded(res, { idleMs: 1000, totalMs: 60_000 });
    const assertion = expect(p).rejects.toMatchObject({ code: "GATEWAY_TIMEOUT", phase: "idle" });
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    expect(cancelled).toBe(true);
  });

  it("readBodyBounded: trickling body is cut by the total cap", async () => {
    let timer;
    const res = new Response(new ReadableStream({
      start(c) { timer = setInterval(() => c.enqueue(new TextEncoder().encode("x")), 500); },
      cancel() { clearInterval(timer); },
    }));
    const p = readBodyBounded(res, { idleMs: 1000, totalMs: 3000 });
    const assertion = expect(p).rejects.toBeInstanceOf(GatewayTimeoutError);
    await vi.advanceTimersByTimeAsync(3600);
    await assertion;
  });

  it("forced SSE->JSON with a stalled upstream body -> 504 within the idle bound", async () => {
    fx.execute.mockResolvedValue({ response: stalledSse(), url: "u", headers: {}, transformedBody: {} });
    const p = handleChatCore(base());
    await vi.advanceTimersByTimeAsync(361_000);
    const r = await p;
    expect(r.success).toBe(false);
    expect(r.status).toBe(504);
  });

  it("non-stream SSE body stalled in nonStreamingHandler -> 504", async () => {
    fx.execute.mockResolvedValue({ response: stalledSse(), url: "u", headers: {}, transformedBody: {} });
    const p = handleChatCore(base(plain));
    await vi.advanceTimersByTimeAsync(361_000);
    expect((await p).status).toBe(504);
  });

  it("disposes the executor's request signal after a non-stream body is consumed", async () => {
    const dispose = vi.fn();
    fx.execute.mockResolvedValue({ response: okJson(), url: "u", headers: {}, transformedBody: {}, dispose });
    const r = await handleChatCore(base(plain));
    expect(r.success).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes on the upstream-error path too", async () => {
    const dispose = vi.fn();
    fx.execute.mockResolvedValue({
      response: new Response(JSON.stringify({ error: { message: "bad" } }), { status: 400, headers: { "content-type": "application/json" } }),
      url: "u", headers: {}, transformedBody: {}, dispose,
    });
    const r = await handleChatCore(base(plain));
    expect(r.success).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe("prefetchRemoteImages", () => {
  it("applies a timeout signal even when the caller passes none", async () => {
    fx.imageOpts.length = 0;
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.test/a.png" } }] }] };
    await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.GEMINI, {});
    expect(fx.imageOpts[0].signal).toBeInstanceOf(AbortSignal);
  });
});
