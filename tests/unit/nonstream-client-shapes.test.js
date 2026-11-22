import { describe, expect, it } from "bun:test";
import { vi } from "#test/vi";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { openAICompletionToGemini, chatCompletionToResponses } = await import("../../open-sse/translator/concerns/nonstreamShapes.js");

const chat = (message, finish_reason = "stop") => ({
  id: "chatcmpl-1", object: "chat.completion", created: 1, model: "m",
  choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason }],
  usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
});

describe("non-stream client shapes", () => {
  it("gives Claude clients a Claude message from an OpenAI upstream", () => {
    const out = translateNonStreamingResponse(chat({ content: "hi" }, "length"), FORMATS.OPENAI, FORMATS.CLAUDE);
    expect(out.type).toBe("message");
    expect(out.stop_reason).toBe("max_tokens");
  });

  it("gives Gemini clients candidates from a Claude upstream, mapping max_tokens", () => {
    const body = { id: "x", content: [{ type: "text", text: "hi" }], stop_reason: "max_tokens", usage: {} };
    const out = translateNonStreamingResponse(body, FORMATS.CLAUDE, FORMATS.GEMINI);
    expect(out.response.candidates[0].finishReason).toBe("MAX_TOKENS");
  });

  it("maps Gemini upstream MAX_TOKENS/SAFETY to OpenAI finish reasons", () => {
    const mk = (finishReason) => ({ candidates: [{ content: { parts: [{ text: "a" }] }, finishReason }] });
    expect(translateNonStreamingResponse(mk("MAX_TOKENS"), FORMATS.GEMINI, FORMATS.OPENAI).choices[0].finish_reason).toBe("length");
    expect(translateNonStreamingResponse(mk("SAFETY"), FORMATS.GEMINI, FORMATS.OPENAI).choices[0].finish_reason).toBe("content_filter");
  });

  it("maps Claude refusal to content_filter", () => {
    const body = { id: "x", content: [{ type: "text", text: "no" }], stop_reason: "refusal" };
    expect(translateNonStreamingResponse(body, FORMATS.CLAUDE, FORMATS.OPENAI).choices[0].finish_reason).toBe("content_filter");
  });

  it("keeps a trailing fence unless a leading ```json fence was stripped", () => {
    const keep = { content: [{ type: "text", text: "Run:\n```python\nprint(1)\n```" }], stop_reason: "end_turn" };
    expect(translateNonStreamingResponse(keep, FORMATS.CLAUDE, FORMATS.OPENAI).choices[0].message.content).toBe("Run:\n```python\nprint(1)\n```");
    const strip = { content: [{ type: "text", text: "```json\n{\"a\":1}\n```" }], stop_reason: "end_turn" };
    expect(translateNonStreamingResponse(strip, FORMATS.CLAUDE, FORMATS.OPENAI).choices[0].message.content).toBe("{\"a\":1}");
  });

  it("emits functionCall parts for Gemini clients", () => {
    const out = openAICompletionToGemini(chat({ content: null, tool_calls: [{ id: "c", type: "function", function: { name: "f", arguments: "{\"a\":1}" } }] }, "tool_calls"));
    expect(out.response.candidates[0].content.parts[0].functionCall).toEqual({ name: "f", args: { a: 1 } });
  });

  it("reports incomplete for truncated Responses output", () => {
    expect(chatCompletionToResponses(chat({ content: "x" }, "length")).status).toBe("incomplete");
  });
});
