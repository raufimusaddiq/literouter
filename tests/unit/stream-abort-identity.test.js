// #147: an aborted stream must name its request, and the persisted row must be an error.
import { describe, it, expect, vi, afterEach } from "vitest";
import { pipeWithDisconnect, createStreamController } from "../../open-sse/utils/streamHandler.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function stalledResponse() {
  // Never yields a chunk; closes only when the consumer cancels.
  return { body: new ReadableStream({ start() {}, cancel() {} }) };
}

describe("pipeWithDisconnect abort identity", () => {
  it("logs request id, provider, model, kind, elapsed and timeout on a stall, and reports it once", async () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const onAbort = vi.fn();
    const controller = createStreamController({ provider: "opencode-go", model: "m", log: { errorLine() {}, line() {} } });
    const out = pipeWithDisconnect(
      stalledResponse(), new TransformStream(), controller, null, 1000,
      { identity: { requestId: "req-123", provider: "opencode-go", model: "m", streamKind: "openai->openai" }, onAbort }
    );
    const reader = out.getReader();
    reader.read().catch(() => {});
    await vi.advanceTimersByTimeAsync(1500);

    const line = err.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("[STREAM-ABORT]"));
    expect(line).toContain("reason=stall_timeout");
    expect(line).toContain("req=req-123");
    expect(line).toContain("provider=opencode-go");
    expect(line).toContain("model=m");
    expect(line).toContain("kind=openai->openai");
    expect(line).toContain("timeout=1000ms");
    expect(line).toMatch(/elapsed=\d+ms/);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onAbort.mock.calls[0][0]).toMatchObject({ reason: "stall_timeout", requestId: "req-123", timeoutMs: 1000 });
  });

  it("does not report an abort for a client disconnect", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const onAbort = vi.fn();
    const controller = createStreamController({ provider: "p", model: "m", log: { errorLine() {}, line() {} } });
    pipeWithDisconnect(stalledResponse(), new TransformStream(), controller, null, 60000, { identity: { requestId: "r" }, onAbort });
    controller.handleDisconnect("client_closed");
    controller.handleError(Object.assign(new Error("aborted"), { name: "AbortError" }));
    expect(onAbort).not.toHaveBeenCalled();
    expect(err.mock.calls.some((c) => String(c[0]).startsWith("[STREAM-ABORT]"))).toBe(false);
  });
});
