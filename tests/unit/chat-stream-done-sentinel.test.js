import { describe, expect, it } from "vitest";
import { FORMATS } from "open-sse/translator/formats.js";
import { createSSEStream, STREAM_MODE } from "open-sse/utils/stream.js";

// Responses and Claude upstreams never send `data: [DONE]`; a Chat Completions
// client behind them must still get exactly one sentinel at the end.
async function collect(targetFormat, events) {
  const upstream = new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(new TextEncoder().encode(e));
      controller.close();
    },
  });
  const transform = createSSEStream({
    mode: STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat: FORMATS.OPENAI,
    provider: "test",
    model: "m",
    connectionId: "c",
  });
  const reader = upstream.pipeThrough(transform).getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe("chat stream sentinel behind a translated upstream", () => {
  it("ends a Responses upstream with exactly one [DONE]", async () => {
    const text = await collect(FORMATS.OPENAI_RESPONSES, [
      sse("response.created", { type: "response.created", response: { id: "r1", status: "in_progress" } }),
      sse("response.output_text.delta", { type: "response.output_text.delta", delta: "hi", output_index: 0, content_index: 0 }),
      sse("response.completed", { type: "response.completed", response: { id: "r1", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }),
    ]);
    expect(text).toContain("\"finish_reason\":\"stop\"");
    expect((text.match(/data: \[DONE\]/g) || []).length).toBe(1);
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("ends a Claude upstream with exactly one [DONE]", async () => {
    const text = await collect(FORMATS.CLAUDE, [
      sse("message_start", { type: "message_start", message: { id: "m1", model: "claude", usage: { input_tokens: 1, output_tokens: 0 } } }),
      sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } }),
      sse("content_block_stop", { type: "content_block_stop", index: 0 }),
      sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }),
      sse("message_stop", { type: "message_stop" }),
    ]);
    expect(text).toContain("\"finish_reason\":\"stop\"");
    expect((text.match(/data: \[DONE\]/g) || []).length).toBe(1);
  });
});
