import { describe, it, expect, afterEach } from "bun:test";
import { vi } from "#test/vi";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { hasMeaningfulSSEBytes } from "../../open-sse/utils/preContentGate.js";
import { getUpstreamHealth, resetUpstreamHealth } from "../../open-sse/services/upstreamHealth.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(),
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
}));

const { handleStreamingResponse } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");
const { createStreamController } = await import("../../open-sse/utils/streamHandler.js");

afterEach(() => {
  resetUpstreamHealth();
  vi.restoreAllMocks();
});

const baseStreamOpts = (providerResponse, extra = {}) => ({
  providerResponse,
  provider: "kenari",
  model: "deepseek-v4-1-flash:high",
  sourceFormat: FORMATS.OPENAI,
  targetFormat: FORMATS.OPENAI,
  userAgent: "",
  body: { messages: [{ role: "user", content: "hi" }] },
  stream: true,
  requestStartTime: Date.now(),
  connectionId: "conn-1",
  clientRawRequest: {},
  reqLogger: null,
  toolNameMap: null,
  customToolNames: null,
  streamController: createStreamController({ provider: "kenari", model: "deepseek-v4-1-flash:high" }),
  streamDetailId: "detail-1",
  reqTag: "req-1",
  ...extra,
});

describe("hasMeaningfulSSEBytes", () => {
  it.each([
    [FORMATS.OPENAI, 'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n', false],
    [FORMATS.OPENAI, 'data: {"choices":[]}\n\n', false],
    [FORMATS.OPENAI, ": keepalive\n\n", false],
    [FORMATS.OPENAI, 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', true],
    [FORMATS.OPENAI, 'data: {"choices":[{"delta":{"reasoning_content":"step"}}]}\n\n', true],
    [FORMATS.OPENAI, 'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1"}]}}]}\n\n', true],
    [FORMATS.OPENAI, "data: [DONE]\n\n", true],
    [FORMATS.CLAUDE, 'event: message_start\ndata: {"type":"message_start"}\n\n', false],
    [FORMATS.CLAUDE, 'event: ping\ndata: {"type":"ping"}\n\n', false],
    [FORMATS.CLAUDE, 'event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"text","text":""}}\n\n', false],
    [FORMATS.CLAUDE, 'event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"tool_use"}}\n\n', true],
    [FORMATS.CLAUDE, 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"hello"}}\n\n', true],
    [FORMATS.CLAUDE, 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"thinking":"hmm"}}\n\n', true],
    [FORMATS.OPENAI_RESPONSES, 'event: response.created\ndata: {"type":"response.created"}\n\n', false],
    [FORMATS.OPENAI_RESPONSES, 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\n', true],
    [FORMATS.GEMINI, 'data: {"candidates":[{"content":{"parts":[{"text":""}]}}]}\n\n', false],
    [FORMATS.GEMINI, 'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n\n', true],
    [FORMATS.OLLAMA, '{"message":{"role":"assistant","content":""},"done":false}\n', false],
    [FORMATS.OLLAMA, '{"message":{"role":"assistant","content":"ok"},"done":false}\n', true],
  ])("classifies meaningful SSE bytes for %s: %j", (format, text, expected) => {
    expect(hasMeaningfulSSEBytes(text, format)).toBe(expected);
  });
});

describe("handleStreamingResponse pre-content failover gate", () => {
  it("flushes buffered framing chunks followed by content and marks success on completion", async () => {
    const enc = new TextEncoder();
    const res = new Response(new ReadableStream({
      start(c) {
        c.enqueue(enc.encode('data: {"choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\n'));
        setTimeout(() => {
          c.enqueue(enc.encode('data: {"choices":[{"index":0,"delta":{"content":"hello"}}]}\n\n'));
          c.enqueue(enc.encode("data: [DONE]\n\n"));
          c.close();
        }, 10);
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });

    const onRequestSuccess = vi.fn();
    const onStreamComplete = vi.fn();
    const out = await handleStreamingResponse(baseStreamOpts(res, {
      allowPreContentFailover: true,
      preContentTimeoutMs: 500,
      onRequestSuccess,
      onStreamComplete,
    }));

    expect(out.success).toBe(true);
    const bodyText = await out.response.text();
    expect(bodyText).toContain('"content":"hello"');
    expect(bodyText).toContain("data: [DONE]");
    await new Promise((r) => setTimeout(r, 10));
    expect(onRequestSuccess).toHaveBeenCalledTimes(1);
    expect(onStreamComplete).toHaveBeenCalledTimes(1);
  });

  it("aborts stalled framing-only upstream, marks health degraded, and fails over in combo", async () => {
    const enc = new TextEncoder();
    let stalledCancelled = false;
    const stalledRes = new Response(new ReadableStream({
      start(c) {
        c.enqueue(enc.encode('data: {"choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\n'));
      },
      cancel() {
        stalledCancelled = true;
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });

    const fallbackBody = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode('data: {"choices":[{"index":0,"delta":{"content":"recovered"}}]}\n\n'));
        c.enqueue(enc.encode("data: [DONE]\n\n"));
        c.close();
      },
    });
    const fallbackResponse = new Response(fallbackBody, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const onRequestSuccess = vi.fn();
    const onStreamAbort = vi.fn();
    const handleSingleModel = vi.fn(async (_body, modelStr, attemptMeta) => {
      if (modelStr === "kn/deepseek-v4-1-flash:high") {
        expect(attemptMeta?.hasFallback).toBe(true);
        const gatedResult = await handleStreamingResponse(baseStreamOpts(stalledRes, {
          allowPreContentFailover: true,
          preContentTimeoutMs: 40,
          onRequestSuccess,
          onStreamAbort,
        }));
        return gatedResult.response;
      }
      expect(attemptMeta?.hasFallback).toBe(false);
      return fallbackResponse;
    });

    const comboRes = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["kn/deepseek-v4-1-flash:high", "ocg/deepseek-v4.1-flash"],
      handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      comboName: "deepseek-combo",
      comboStrategy: "fallback",
      preContentFailover: true,
    });

    expect(comboRes.ok).toBe(true);
    expect(await comboRes.text()).toContain("recovered");
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
    expect(onStreamAbort).toHaveBeenCalledTimes(1);
    expect(onStreamAbort.mock.calls[0][0]).toMatchObject({ reason: "pre_content_stall", provider: "kenari" });
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(stalledCancelled).toBe(true);
    expect(getUpstreamHealth("kenari", "deepseek-v4-1-flash:high").degraded).toBe(true);
  });

  it("returns 499 without recording an upstream stall on client abort during pre-content wait", async () => {
    const enc = new TextEncoder();
    const res = new Response(new ReadableStream({
      start(c) {
        c.enqueue(enc.encode('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n'));
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });

    const clientCtrl = new AbortController();
    setTimeout(() => clientCtrl.abort(), 15);

    const onStreamAbort = vi.fn();
    const out = await handleStreamingResponse(baseStreamOpts(res, {
      allowPreContentFailover: true,
      preContentTimeoutMs: 500,
      clientSignal: clientCtrl.signal,
      onStreamAbort,
    }));

    expect(out.success).toBe(false);
    expect(out.status).toBe(499);
    expect(onStreamAbort).not.toHaveBeenCalled();
    expect(getUpstreamHealth("kenari", "deepseek-v4-1-flash:high").degraded).toBe(false);
  });

  it("does not apply pre-content buffering when allowPreContentFailover is false", async () => {
    const res = new Response(new ReadableStream({
      start() {},
    }), { status: 200, headers: { "content-type": "text/event-stream" } });

    const out = await handleStreamingResponse(baseStreamOpts(res, {
      allowPreContentFailover: false,
      preContentTimeoutMs: 20,
    }));

    expect(out.success).toBe(true);
    await out.response.body.cancel();
  });
});
