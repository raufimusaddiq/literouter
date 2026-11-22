// T-37: honest client usage, bounded accumulators, finalize-on-cancel, single detail write.
import { describe, it, expect, beforeEach } from "bun:test";
import { vi } from "#test/vi";

const saved = [];
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  saveRequestDetail: vi.fn(async (d) => { saved.push(d); }),
  saveRequestUsage: vi.fn(async () => {}),
}));

import { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { buildOnStreamComplete } from "../../open-sse/handlers/chatCore/streamingHandler.js";

const enc = new TextEncoder();
const chunk = (o) => `data: ${JSON.stringify(o)}\n\n`;
const delta = (content, extra = {}) => chunk({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { content }, finish_reason: null }], ...extra });
const finish = (extra = {}) => chunk({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], ...extra });
const usageChunk = (u) => chunk({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [], usage: u });
const BODY = { model: "m", messages: [{ role: "user", content: "hello world ".repeat(100) }] };

async function run(ts, parts, { close = true } = {}) {
  const writer = ts.writable.getWriter();
  const reader = ts.readable.getReader();
  const dec = new TextDecoder();
  let text = "";
  const pump = (async () => { for (;;) { const { done, value } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }); } })();
  for (const p of parts) await writer.write(enc.encode(p));
  if (close) { await writer.close(); await pump; }
  else await new Promise((r) => setTimeout(r, 20));
  const frames = text.split("\n").filter((f) => f.startsWith("data: ") && !f.includes("[DONE]")).map((f) => JSON.parse(f.slice(6)));
  return { text, frames, writer, reader };
}

describe("client usage is the upstream's, unbuffered", () => {
  it("passthrough: upstream usage on the finish chunk reaches the client as-is (no +2000)", async () => {
    const up = { prompt_tokens: 100, completion_tokens: 7, total_tokens: 107 };
    const ts = createPassthroughStreamWithLogger("openai", null, "m", "c", BODY, null, null);
    const { frames } = await run(ts, [delta("hi"), finish({ usage: up }), "data: [DONE]\n\n"]);
    const u = frames.find((f) => f.usage)?.usage;
    expect(u).toEqual(up);
  });

  it("passthrough: trailing upstream usage chunk is forwarded untouched", async () => {
    const up = { prompt_tokens: 50, completion_tokens: 3, total_tokens: 53 };
    const ts = createPassthroughStreamWithLogger("openai", null, "m", "c", BODY, null, null);
    const { frames } = await run(ts, [delta("hi"), finish(), usageChunk(up), "data: [DONE]\n\n"]);
    expect(frames.filter((f) => f.usage).map((f) => f.usage)).toEqual([up]);
  });

  it("include_usage absent + no upstream usage -> no fabricated usage chunk", async () => {
    let internal = null;
    const ts = createPassthroughStreamWithLogger("openai", null, "m", "c", BODY, (_c, u) => { internal = u; }, null);
    const { frames } = await run(ts, [delta("hello there"), finish(), "data: [DONE]\n\n"]);
    expect(frames.some((f) => f.usage)).toBe(false);
    expect(internal.estimated).toBe(true); // internal accounting still estimates
  });

  it("include_usage true + no upstream usage -> spec-shaped final chunk (choices: []) before [DONE]", async () => {
    const body = { ...BODY, stream_options: { include_usage: true } };
    const ts = createPassthroughStreamWithLogger("openai", null, "m", "c", body, null, null);
    const { frames, text } = await run(ts, [delta("hello there"), finish(), "data: [DONE]\n\n"]);
    const last = frames[frames.length - 1];
    expect(last.choices).toEqual([]);
    expect(last.object).toBe("chat.completion.chunk");
    expect(last.usage.estimated).toBe(true);
    expect(last.usage.prompt_tokens).toBeGreaterThan(0);
    expect(last.usage.prompt_tokens).toBeLessThan(2000);
    expect(frames.filter((f) => f.usage)).toHaveLength(1);
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("include_usage true + upstream usage -> no extra estimated chunk", async () => {
    const body = { ...BODY, stream_options: { include_usage: true } };
    const up = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 };
    const ts = createPassthroughStreamWithLogger("openai", null, "m", "c", body, null, null);
    const { frames } = await run(ts, [delta("x"), finish(), usageChunk(up), "data: [DONE]\n\n"]);
    expect(frames.filter((f) => f.usage).map((f) => f.usage)).toEqual([up]);
  });

  it("input estimate is computed at most once, and not at the finish chunk", async () => {
    const spy = vi.spyOn(JSON, "stringify");
    const body = { ...BODY, stream_options: { include_usage: true } };
    const ts = createPassthroughStreamWithLogger("openai", null, "m", "c", body, null, null);
    await run(ts, [delta("hello"), finish(), "data: [DONE]\n\n"]);
    const bodyStringifies = spy.mock.calls.filter(([v]) => v === body).length;
    spy.mockRestore();
    expect(bodyStringifies).toBe(1);
  });

  it("claude upstream -> openai client: usage is the upstream's", async () => {
    const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const ts = createSSETransformStreamWithLogger("claude", "openai", "claude", null, null, "m", "c", BODY, null, null);
    const { frames } = await run(ts, [
      sse("message_start", { type: "message_start", message: { id: "m1", model: "m", usage: { input_tokens: 300, output_tokens: 1 } } }),
      sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "OK" } }),
      sse("content_block_stop", { type: "content_block_stop", index: 0 }),
      sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }),
      sse("message_stop", { type: "message_stop" }),
    ]);
    expect(frames.find((f) => f.usage).usage.prompt_tokens).toBe(300);
  });
});

describe("accumulator cap", () => {
  it("keeps head + tail within the cap for a huge response", async () => {
    let content = null;
    const ts = createPassthroughStreamWithLogger("openai", null, "m", "c", BODY, (c) => { content = c; }, null);
    const parts = [];
    for (let i = 0; i < 400; i++) parts.push(delta(`${String(i).padStart(4, "0")}${"z".repeat(996)}`));
    parts.push(finish(), "data: [DONE]\n\n");
    await run(ts, parts);
    expect(content.content.length).toBeLessThan(5 * 1024 + 100);
    expect(content.content.startsWith("0000")).toBe(true);
    expect(content.content).toContain("chars omitted");
    expect(content.content.endsWith("z")).toBe(true);
    expect(content.content).toContain("0399");
  });
});

describe("cancelled stream finalizes", () => {
  beforeEach(() => { saved.length = 0; });

  const make = () => buildOnStreamComplete({
    provider: "p", model: "m", connectionId: "c", apiKey: null, requestStartTime: Date.now() - 50,
    body: BODY, stream: true, finalBody: BODY, translatedBody: null, clientRawRequest: { endpoint: "/v1/chat/completions" },
    pxpipe: undefined, reqTag: "t", log: null,
  });

  it("client cancel mid-stream -> one row, client_cancelled, usage estimated from output", async () => {
    const { onStreamComplete } = make();
    const ts = createPassthroughStreamWithLogger("openai", null, "m", "c", BODY, onStreamComplete, null);
    await run(ts, [delta("partial output so far")], { close: false });
    ts.finalizeOnCancel();
    ts.finalizeOnCancel(); // idempotent
    await new Promise((r) => setTimeout(r, 10));
    expect(saved).toHaveLength(1);
    expect(saved[0].status).toBe("client_cancelled");
    expect(saved[0].tokens.estimated).toBe(true);
    expect(saved[0].tokens.completion_tokens).toBeGreaterThan(0);
    expect(saved[0].response.content).toContain("partial output so far");
  });

  it("client cancel records upstream usage when it was already seen", async () => {
    const { onStreamComplete } = make();
    const up = { prompt_tokens: 77, completion_tokens: 4, total_tokens: 81 };
    const ts = createPassthroughStreamWithLogger("openai", null, "m", "c", BODY, onStreamComplete, null);
    await run(ts, [delta("abc", { usage: up })], { close: false });
    ts.finalizeOnCancel();
    await new Promise((r) => setTimeout(r, 10));
    expect(saved[0].status).toBe("client_cancelled");
    expect(saved[0].tokens.prompt_tokens).toBe(77);
    expect(saved[0].tokens.estimated).toBeUndefined();
  });

  it("cancel after the terminal event is a normal success, written once", async () => {
    const { onStreamComplete } = make();
    const ts = createPassthroughStreamWithLogger("openai", null, "m", "c", BODY, onStreamComplete, null);
    await run(ts, [delta("done"), finish({ usage: { prompt_tokens: 1, completion_tokens: 1 } })], { close: false });
    ts.finalizeOnCancel();
    await new Promise((r) => setTimeout(r, 10));
    expect(saved).toHaveLength(1);
    expect(saved[0].status).toBe("success");
  });

  it("a normally completed stream writes exactly one row", async () => {
    const { onStreamComplete } = make();
    const ts = createPassthroughStreamWithLogger("openai", null, "m", "c", BODY, onStreamComplete, null);
    await run(ts, [delta("hi"), finish(), "data: [DONE]\n\n"]);
    ts.finalizeOnCancel(); // late cancel must not write again
    await new Promise((r) => setTimeout(r, 10));
    expect(saved).toHaveLength(1);
    expect(saved[0].status).toBe("success");
  });
});
