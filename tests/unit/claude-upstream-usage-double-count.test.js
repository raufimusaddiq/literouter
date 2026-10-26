// #130 (LiteRouter equivalent of decolua/9router#5213): Claude cache usage across
// format translation. Claude reports input_tokens EXCLUDING cache; OpenAI reports
// prompt_tokens INCLUDING it. Each fact is asserted with exact numbers.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

import { saveRequestUsage } from "@/lib/usageDb.js";
import "../../open-sse/translator/index.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { saveUsageStats } from "../../open-sse/handlers/chatCore/requestDetail.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { openAICompletionToClaudeMessage } from "../../open-sse/translator/response/nonstream-to-claude.js";

const BUFFER = 2000; // usageTracking.js BUFFER_TOKENS, added to client-visible prompt/total

const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

// Upstream #5213 fixture: in 255, cache read 228,399, cache write 253, out 302.
const IN = 255, READ = 228399, WRITE = 253, OUT = 302;
const PROMPT = IN + READ + WRITE; // 228,907, counted once

async function streamClaudeToOpenAI() {
  let finalUsage = null;
  const ts = createSSETransformStreamWithLogger("claude", "openai", "claude", null, null, "claude-x", "c1",
    { messages: [{ role: "user", content: "hi" }] }, (_c, u) => { finalUsage = u; }, null);
  const writer = ts.writable.getWriter();
  const reader = ts.readable.getReader();
  const dec = new TextDecoder();
  let text = "";
  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
    }
  })();
  const enc = new TextEncoder();
  for (const e of [
    sse("message_start", { type: "message_start", message: { id: "m1", model: "claude-x", usage: { input_tokens: IN, output_tokens: 1, cache_read_input_tokens: READ, cache_creation_input_tokens: WRITE } } }),
    sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "OK" } }),
    sse("content_block_stop", { type: "content_block_stop", index: 0 }),
    sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: OUT } }),
    sse("message_stop", { type: "message_stop" }),
  ]) await writer.write(enc.encode(e));
  await writer.close();
  await pump;
  const clientUsage = text.split("\n")
    .filter((l) => l.startsWith("data: {"))
    .map((l) => JSON.parse(l.slice(6)))
    .find((c) => c.usage)?.usage;
  return { finalUsage, clientUsage };
}

async function storedTokens(usage) {
  saveRequestUsage.mockClear();
  saveUsageStats({ provider: "claude", model: "claude-x", tokens: usage, connectionId: "c1", silent: true });
  expect(saveRequestUsage).toHaveBeenCalledTimes(1);
  return saveRequestUsage.mock.calls[0][0].tokens;
}

describe("#130 path A: stream, Claude upstream -> OpenAI client", () => {
  it("stores prompt = input + cache_read + cache_write, counted once", async () => {
    const { finalUsage } = await streamClaudeToOpenAI();
    const stored = await storedTokens(finalUsage);
    expect(stored.prompt_tokens).toBe(PROMPT);
  });

  it("stores cache read and cache write unchanged", async () => {
    const { finalUsage } = await streamClaudeToOpenAI();
    const stored = await storedTokens(finalUsage);
    expect(stored.cached_tokens).toBe(READ);
    expect(stored.cache_creation_input_tokens).toBe(WRITE);
  });

  it("stores total = prompt + completion", async () => {
    const { finalUsage } = await streamClaudeToOpenAI();
    const stored = await storedTokens(finalUsage);
    expect(stored.total_tokens).toBe(PROMPT + OUT);
  });

  it("shows the client the cache-inclusive prompt plus the buffer, once", async () => {
    const { clientUsage } = await streamClaudeToOpenAI();
    expect(clientUsage.prompt_tokens).toBe(PROMPT + BUFFER);
  });

  it("shows the client the cache split in prompt_tokens_details", async () => {
    const { clientUsage } = await streamClaudeToOpenAI();
    expect(clientUsage.prompt_tokens_details).toEqual({ cached_tokens: READ, cache_creation_tokens: WRITE });
  });
});

describe("#130 path B: non-stream, Claude upstream -> OpenAI client", () => {
  // Upstream #5213 non-stream fixture: in 489, read 4,702, write 2, out 387.
  const claudeBody = () => ({
    id: "m1", type: "message", role: "assistant", model: "claude-x",
    content: [{ type: "text", text: "OK" }], stop_reason: "end_turn",
    usage: { input_tokens: 489, output_tokens: 387, cache_read_input_tokens: 4702, cache_creation_input_tokens: 2 },
  });

  it("gives the client the cache-inclusive prompt", () => {
    const out = translateNonStreamingResponse(claudeBody(), "claude", "openai");
    expect(out.usage.prompt_tokens).toBe(489 + 4702 + 2);
  });

  it("gives the client the cache split", () => {
    const out = translateNonStreamingResponse(claudeBody(), "claude", "openai");
    expect(out.usage.prompt_tokens_details).toEqual({ cached_tokens: 4702, cache_creation_tokens: 2 });
  });

  it("gives the client total = prompt + completion", () => {
    const out = translateNonStreamingResponse(claudeBody(), "claude", "openai");
    expect(out.usage.total_tokens).toBe(489 + 4702 + 2 + 387);
  });

  it("stores the raw Claude usage with the cache counted once (unchanged)", async () => {
    const stored = await storedTokens({ prompt_tokens: 489, completion_tokens: 387, cache_read_input_tokens: 4702, cache_creation_input_tokens: 2 });
    expect(stored.prompt_tokens).toBe(489 + 4702 + 2);
  });
});

describe("#130 path C: non-stream, OpenAI upstream -> Claude client", () => {
  const openaiBody = (usage) => ({ id: "chatcmpl-1", model: "m", choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage });

  it("reports only the uncached part as input_tokens", () => {
    const out = openAICompletionToClaudeMessage(openaiBody({ prompt_tokens: 25454, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 25408 } }));
    expect(out.usage.input_tokens).toBe(46);
  });

  it("reports the cache read as cache_read_input_tokens", () => {
    const out = openAICompletionToClaudeMessage(openaiBody({ prompt_tokens: 25454, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 25408 } }));
    expect(out.usage.cache_read_input_tokens).toBe(25408);
  });

  it("splits a cache write as cache_creation_input_tokens", () => {
    const out = openAICompletionToClaudeMessage(openaiBody({ prompt_tokens: 1000, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 600, cache_creation_tokens: 300 } }));
    expect(out.usage).toEqual({ input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 600, cache_creation_input_tokens: 300 });
  });

  it("is unchanged without cache data", () => {
    const out = openAICompletionToClaudeMessage(openaiBody({ prompt_tokens: 50, completion_tokens: 2 }));
    expect(out.usage).toEqual({ input_tokens: 50, output_tokens: 2 });
  });

  it("passes Claude-shaped usage through", () => {
    const out = openAICompletionToClaudeMessage(openaiBody({ input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 90 }));
    expect(out.usage).toEqual({ input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 90 });
  });
});
