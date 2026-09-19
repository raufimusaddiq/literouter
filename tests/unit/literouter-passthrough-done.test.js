import { describe, expect, it } from "vitest";
import { FORMATS } from "open-sse/translator/formats.js";
import { createPassthroughStreamWithLogger } from "open-sse/utils/stream.js";

// PRD 20: a passthrough stream must terminate with exactly one OpenAI sentinel.
// Upstreams commonly send their own `data: [DONE]`; forwarding that plus a
// synthesized one is invalid SSE for strict clients.
async function collect(chunks) {
  const upstream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
      controller.close();
    },
  });

  const transform = createPassthroughStreamWithLogger("openai-compatible-chat-x", null, "m", "c", {})
    ?? createPassthroughStreamWithLogger();

  const out = upstream.pipeThrough(transform);
  const reader = out.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe("passthrough stream termination", () => {
  it("emits exactly one [DONE] when the upstream sends its own", async () => {
    const chunk = (delta) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta }] })}\n\n`;
    const text = await collect([
      chunk({ role: "assistant", content: "hi" }),
      chunk({}),
      "data: [DONE]\n\n",
    ]);
    const count = (text.match(/data: \[DONE\]/g) || []).length;
    expect(count).toBe(1);
  });

  it("synthesizes one [DONE] when the upstream sends none", async () => {
    const chunk = (delta) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta }] })}\n\n`;
    const text = await collect([chunk({ role: "assistant", content: "hi" }), chunk({})]);
    const count = (text.match(/data: \[DONE\]/g) || []).length;
    expect(count).toBe(1);
  });
});
