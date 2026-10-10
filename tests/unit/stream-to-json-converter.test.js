import { describe, it, expect } from "vitest";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";

function streamOf(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

const item = { type: "message", role: "assistant", content: [{ type: "output_text", text: "x".repeat(5000) }] };
const events = [
  `event: response.created\ndata: ${JSON.stringify({ response: { id: "resp_1", created_at: 123 } })}\n\n`,
  `event: response.output_item.done\ndata: ${JSON.stringify({ output_index: 0, item })}\n\n`,
  `event: response.completed\ndata: ${JSON.stringify({ response: { usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } } })}\n\n`,
].join("");

const expected = {
  id: "resp_1",
  object: "response",
  created_at: 123,
  status: "completed",
  output: [item],
  usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
};

describe("convertResponsesStreamToJson chunk boundaries", () => {
  it("parses events delivered in one chunk", async () => {
    expect(await convertResponsesStreamToJson(streamOf([events]))).toEqual(expected);
  });

  it("parses events split into small chunks (long data lines span many chunks)", async () => {
    const chunks = [];
    for (let i = 0; i < events.length; i += 7) chunks.push(events.slice(i, i + 7));
    expect(await convertResponsesStreamToJson(streamOf(chunks))).toEqual(expected);
  });

  it("detects a blank-line separator split across two chunks", async () => {
    const chunks = [];
    let start = 0;
    for (let i = events.indexOf("\n\n"); i !== -1; i = events.indexOf("\n\n", i + 2)) {
      chunks.push(events.slice(start, i + 1));
      start = i + 1;
    }
    chunks.push(events.slice(start));
    expect(await convertResponsesStreamToJson(streamOf(chunks))).toEqual(expected);
  });
});
