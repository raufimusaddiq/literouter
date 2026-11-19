// T-35: bounded, non-replaying timeouts + pending counter safety.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fx = vi.hoisted(() => ({ fetch: vi.fn(), pending: vi.fn(), execute: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fx.fetch }));
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

const { BaseExecutor } = await import("../../open-sse/executors/base.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { GatewayTimeoutError } = await import("../../open-sse/utils/requestTimeouts.js");

const okJson = () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), {
  status: 200, headers: { "content-type": "application/json" },
});

// fetch that resolves after `ms`, or rejects with the signal's reason when aborted first
const slowFetch = (ms, make = okJson) => (url, init) => new Promise((resolve, reject) => {
  const t = setTimeout(() => resolve(make()), ms);
  init.signal.addEventListener("abort", () => { clearTimeout(t); reject(init.signal.reason); }, { once: true });
});

const exec = () => new BaseExecutor("openai", { baseUrl: "https://example.test/v1/chat/completions" });
const run = (stream, signal) => exec().execute({ model: "m", body: { messages: [] }, stream, credentials: { apiKey: "k" }, signal });

describe("BaseExecutor timeouts", () => {
  beforeEach(() => { vi.useFakeTimers(); fx.fetch.mockReset(); });
  afterEach(() => vi.useRealTimers());

  it("non-stream answer slower than the old 60s headers timeout is not cut and not replayed", async () => {
    fx.fetch.mockImplementation(slowFetch(90_000));
    const p = run(false);
    await vi.advanceTimersByTimeAsync(90_000);
    const res = await p;
    expect(res.response.status).toBe(200);
    expect(fx.fetch).toHaveBeenCalledTimes(1);
  });

  it("non-stream honours the provider's own timeoutMs as the total bound", async () => {
    fx.fetch.mockImplementation(slowFetch(10 * 60_000));
    const e = new BaseExecutor("typesafe", { baseUrl: "https://example.test/v1/chat/completions", timeoutMs: 10_000 });
    const p = e.execute({ model: "m", body: { messages: [] }, stream: false, credentials: { apiKey: "k" } });
    const assertion = expect(p).rejects.toMatchObject({ code: "GATEWAY_TIMEOUT", status: 504, phase: "total" });
    await vi.advanceTimersByTimeAsync(11_000);
    await assertion;
    expect(fx.fetch).toHaveBeenCalledTimes(1);
  });

  it("stream with no headers inside the headers timeout -> GatewayTimeout, single attempt (no replay)", async () => {
    fx.fetch.mockImplementation(slowFetch(10 * 60_000));
    const p = run(true);
    const assertion = expect(p).rejects.toMatchObject({ code: "GATEWAY_TIMEOUT", status: 504, phase: "headers" });
    await vi.advanceTimersByTimeAsync(61_000);
    await assertion;
    expect(fx.fetch).toHaveBeenCalledTimes(1);
  });

  it("non-stream past the total budget -> GatewayTimeout, single attempt", async () => {
    fx.fetch.mockImplementation(slowFetch(60 * 60_000));
    const p = run(false);
    const assertion = expect(p).rejects.toMatchObject({ code: "GATEWAY_TIMEOUT", phase: "total" });
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1000);
    await assertion;
    expect(fx.fetch).toHaveBeenCalledTimes(1);
  });

  it("client abort is rethrown as AbortError (not a timeout, not retried)", async () => {
    fx.fetch.mockImplementation(slowFetch(60_000));
    const ctrl = new AbortController();
    const p = run(true, ctrl.signal);
    const assertion = expect(p).rejects.toMatchObject({ name: "AbortError" });
    ctrl.abort();
    await assertion;
    expect(fx.fetch).toHaveBeenCalledTimes(1);
  });

  it("abort during a retry sleep stops immediately", async () => {
    fx.fetch.mockResolvedValue(new Response("bad", { status: 502 }));
    const ctrl = new AbortController();
    const p = run(false, ctrl.signal);
    const assertion = expect(p).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(100); // inside the 3s retry sleep
    ctrl.abort();
    await assertion;
    expect(fx.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("handleChatCore", () => {
  const base = (extra = {}) => ({
    body: { model: "deepseek/deepseek-chat", messages: [{ role: "user", content: "hi" }], stream: false },
    modelInfo: { provider: "deepseek", model: "deepseek-chat" },
    credentials: { apiKey: "k" },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: {} },
    connectionId: "c1",
    ...extra,
  });
  const balance = () => fx.pending.mock.calls.reduce((n, c) => n + (c[3] ? 1 : -1), 0);

  beforeEach(() => { fx.pending.mockReset(); fx.execute.mockReset(); });

  it("executor timeout -> 504 result and the pending counter is released", async () => {
    fx.execute.mockRejectedValue(new GatewayTimeoutError("slow", "total"));
    const r = await handleChatCore(base());
    expect(r.success).toBe(false);
    expect(r.status).toBe(504);
    expect(balance()).toBe(0);
  });

  it("client abort at the executor -> 499 and the counter is released", async () => {
    const ctrl = new AbortController();
    fx.execute.mockImplementation(async ({ signal }) => {
      expect(signal.aborted).toBe(false);
      ctrl.abort();
      expect(signal.aborted).toBe(true); // client signal reaches the executor signal
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    const r = await handleChatCore(base({ clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: {}, signal: ctrl.signal } }));
    expect(r.status).toBe(499);
    expect(balance()).toBe(0);
  });

  it("a throw after the counter is raised (outside the executor try) still releases it", async () => {
    fx.execute.mockResolvedValue({
      response: { get status() { throw new Error("boom"); } },
      url: "u", headers: {}, transformedBody: {},
    });
    await expect(handleChatCore(base())).rejects.toThrow("boom");
    expect(fx.pending).toHaveBeenCalled();
    expect(balance()).toBe(0);
  });

  it("client abort while the upstream body is being read: 499, no success usage", async () => {
    const ctrl = new AbortController();
    fx.execute.mockImplementation(async ({ signal }) => ({
      response: new Response(new ReadableStream({
        start(c) { signal.addEventListener("abort", () => c.error(signal.reason), { once: true }); },
      }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "u", headers: {}, transformedBody: {},
    }));
    const onRequestSuccess = vi.fn();
    const p = handleChatCore(base({ onRequestSuccess, clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: {}, signal: ctrl.signal } }));
    setTimeout(() => ctrl.abort(), 20);
    const r = await p;
    expect(r.status).toBe(499);
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(balance()).toBe(0);
  });
});

describe("upstream 408 (request body timed out)", () => {
  beforeEach(() => { fx.fetch.mockReset(); });

  it("is retried once on a fresh socket, then returned", async () => {
    fx.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "request body timed out" } }), { status: 408 }))
      .mockImplementationOnce(async () => okJson());
    const res = await run(false);
    expect(res.response.status).toBe(200);
    expect(fx.fetch).toHaveBeenCalledTimes(2);
    expect(fx.fetch.mock.calls[1][2]).toMatchObject({ forceFreshSocket: true });
  });

  it("is classified as transient (fallback, short cooldown) and not an invalid_request_error", async () => {
    const { checkFallbackError } = await import("../../open-sse/services/accountFallback.js");
    const { buildErrorBody } = await import("../../open-sse/utils/error.js");
    expect(checkFallbackError(408, "request body timed out").shouldFallback).toBe(true);
    expect(buildErrorBody(408, "x").error.type).toBe("server_error");
  });
});
