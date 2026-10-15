// The dashboard model test used to wait for a FULL generation (stream:false,
// max_tokens:1024) under a hardcoded 15 s abort. On a heavy-tailed provider that
// reported healthy-but-slow models as broken while the upstream call still
// completed and was billed. It is now a first-token probe: stream, resolve on the
// first token, cancel the rest, and report a 504 "may be slow" instead of a bare
// 500 carrying a raw DOMException.
//
// The route module pulls in Next.js-only deps (@/lib/localDb, etc.) that don't
// resolve under raw vitest, so we mock them and exercise the exported function.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/localDb", () => ({ getApiKeys: vi.fn(async () => [{ key: "test-key", isActive: true }]) }));
vi.mock("@/shared/constants/config", () => ({ UPDATER_CONFIG: { appPort: 20127 } }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: vi.fn(async () => "cli-token") }));

const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");

const BASE = "http://127.0.0.1:20127";

/** Build a real streaming Response so the reader path is exercised, not faked. */
function sseResponse(chunks, { status = 200 } = {}) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status, headers: { "Content-Type": "text/event-stream" } }
  );
}

function timeoutError() {
  return Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
}

describe("pingModelByKind first-token probe", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests a stream and resolves on the first token without consuming the rest", async () => {
    const cancelled = vi.fn();
    const encoder = new TextEncoder();
    let sent = 0;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (h) => (h.toLowerCase() === "content-type" ? "text/event-stream" : null) },
      body: {
        getReader: () => ({
          read: async () => {
            sent += 1;
            if (sent === 1) {
              return { done: false, value: encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n') };
            }
            // A real stream would keep producing here; the probe must stop first.
            return new Promise(() => {});
          },
          cancel: cancelled,
        }),
      },
    });

    const result = await pingModelByKind("kenari/deepseek-v4-1-flash", "llm", BASE);

    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(1024);

    // The rest of the generation must not be read or paid for.
    expect(sent).toBe(1);
    expect(cancelled).toHaveBeenCalled();
  });

  it("treats a reasoning-only first delta as a reachable model", async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}\n\n'])
    );

    const result = await pingModelByKind("cline-pass/kimi-k3", "llm", BASE);
    expect(result.ok).toBe(true);
  });

  it("counts content delivered together with the terminal finish_reason as a token", async () => {
    // Providers may put content and finish_reason in the same event; that is a
    // success, not an empty stream.
    fetchMock.mockResolvedValue(
      sseResponse(['data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\n'])
    );

    const result = await pingModelByKind("kenari/deepseek-v4-1-flash", "llm", BASE);
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
  });

  it("reports a timeout as slow-not-broken with a 504, never a raw DOMException", async () => {
    fetchMock.mockRejectedValue(timeoutError());

    const result = await pingModelByKind("kenari/deepseek-v4-1-flash", "llm", BASE);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(504);
    expect(result.connectionFailure).toBe(true);
    expect(result.error).toMatch(/may be slow, not unreachable/);
    expect(result.error).not.toMatch(/aborted due to timeout/);
  });

  it("reports a connect failure as unreachable with a 502", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("fetch failed"), { name: "TypeError" }));

    const result = await pingModelByKind("kenari/deepseek-v4-1-flash", "llm", BASE);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.connectionFailure).toBe(true);
    expect(result.error).toMatch(/Could not reach the model/);
  });

  it("reports a stall before the first token as slow-not-broken", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (h) => (h.toLowerCase() === "content-type" ? "text/event-stream" : null) },
      body: {
        getReader: () => ({
          read: async () => { throw timeoutError(); },
          cancel: vi.fn(),
        }),
      },
    });

    const result = await pingModelByKind("kenari/deepseek-v4-1-flash", "llm", BASE);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(504);
    expect(result.error).toMatch(/may be slow, not unreachable/);
  });

  it("surfaces an in-band error frame instead of reporting a bogus success", async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['data: {"error":{"message":"upstream exploded"}}\n\n'])
    );

    const result = await pingModelByKind("kenari/deepseek-v4-1-flash", "llm", BASE);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/upstream exploded/);
  });

  it("fails when the stream closes without ever sending a token", async () => {
    fetchMock.mockResolvedValue(sseResponse([]));

    const result = await pingModelByKind("kenari/deepseek-v4-1-flash", "llm", BASE);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/without sending any tokens/);
  });

  it("keeps the #3010 JSON-path verdicts for non-streaming bodies", async () => {
    const jsonOnly = {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ finish_reason: "length", message: { content: "", reasoning: "thinking..." } }],
      }),
    };
    fetchMock.mockResolvedValue(jsonOnly);

    const result = await pingModelByKind("cline-pass/kimi-k3", "llm", BASE);
    expect(result.ok).toBe(true);
    expect(result.note).toMatch(/reasoning-only/);
  });
});

describe("MODEL_TEST_TIMEOUT_MS", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to the router's first-chunk budget rather than the old 15 s", async () => {
    vi.resetModules();
    const mod = await import("../../open-sse/config/runtimeConfig.js");
    expect(mod.MODEL_TEST_TIMEOUT_MS).toBe(200 * 1000);
  });

  it("honours a positive env override and ignores a garbage one", async () => {
    vi.stubEnv("MODEL_TEST_TIMEOUT_MS", "45000");
    vi.resetModules();
    let mod = await import("../../open-sse/config/runtimeConfig.js");
    expect(mod.MODEL_TEST_TIMEOUT_MS).toBe(45000);

    vi.stubEnv("MODEL_TEST_TIMEOUT_MS", "not-a-number");
    vi.resetModules();
    mod = await import("../../open-sse/config/runtimeConfig.js");
    expect(mod.MODEL_TEST_TIMEOUT_MS).toBe(200 * 1000);
  });
});
