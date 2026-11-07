// Anthropic `ping` events and upstream SSE comments produce no translated output.
// Without a heartbeat the downstream client sees zero bytes through long thinking
// and trips its own read timeout while the gateway's stall watchdog stays quiet.
import { describe, it, expect } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

async function run(upstreamFormat, clientFormat, raw) {
  const enc = new TextEncoder();
  const src = new ReadableStream({ start(c) { c.enqueue(enc.encode(raw)); c.close(); } });
  const out = src.pipeThrough(createSSETransformStreamWithLogger(upstreamFormat, clientFormat, "claude", null, null, "claude-opus-5"));
  const reader = out.getReader();
  const dec = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += typeof value === "string" ? value : dec.decode(value, { stream: true });
  }
  return text;
}

const ev = (o) => `data: ${JSON.stringify(o)}\n\n`;
const START = ev({ type: "message_start", message: { id: "m1", model: "claude-opus-5", role: "assistant", content: [], usage: { input_tokens: 1, output_tokens: 0 } } });
const PING = ev({ type: "ping" });

describe("translate-mode heartbeat", () => {
  it("emits an SSE comment for a Claude ping toward an OpenAI client, throttled", async () => {
    const out = await run(FORMATS.CLAUDE, FORMATS.OPENAI, START + PING + PING + PING);
    expect(out.match(/: keepalive/g)?.length).toBe(1);
    expect(out).not.toContain('"type":"ping"');
  });

  it("forwards an upstream SSE comment as a heartbeat", async () => {
    const out = await run(FORMATS.CLAUDE, FORMATS.OPENAI, START + ": kiro-validation\n\n");
    expect(out).toContain(": keepalive");
  });

  it("emits a native ping toward a Claude client", async () => {
    const out = await run(FORMATS.OPENAI, FORMATS.CLAUDE, ": hb\n\n");
    expect(out).toContain("event: ping");
  });

  it("does not emit a heartbeat when there is no ping", async () => {
    const out = await run(FORMATS.CLAUDE, FORMATS.OPENAI, START);
    expect(out).not.toContain(": keepalive");
  });
});
