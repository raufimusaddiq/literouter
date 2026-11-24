import { describe, it, expect } from "bun:test";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const R2O = (body) => translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", body, true, null, null);
const O2R = (body) => translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "m", body, true, null, null);
const R2R = (body) => translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, "m", body, true, null, null);

describe("Codex CLI Responses → OpenAI", () => {
  it("assistant has no empty tool_calls array when all names are empty", () => {
    const out = R2O({
      input: [
        { type: "function_call", call_id: "c1", name: "", arguments: "{}" },
      ],
    });
    expect(out.messages.every((m) => !m.tool_calls || m.tool_calls.length > 0)).toBe(true);
  });

  it("function_call arguments end up as a string", () => {
    const out = R2O({
      input: [{ type: "function_call", call_id: "c1", name: "f", arguments: { a: 1 } }],
    });
    const asst = out.messages.find((m) => m.tool_calls);
    expect(typeof asst.tool_calls[0].function.arguments).toBe("string");
  });

  it("input_image with file_id is not used as a raw url", () => {
    const out = R2O({
      input: [{ type: "message", role: "user", content: [
        { type: "input_image", file_id: "file-abc" },
        { type: "input_text", text: "look" },
      ] }],
    });
    const userMsg = out.messages.find((m) => m.role === "user");
    expect(userMsg.content).toEqual([{ type: "text", text: "look" }]);
  });

  it("keeps pending reasoning when a message carries no content", () => {
    const out = R2O({
      input: [
        { type: "reasoning", summary: [{ type: "summary_text", text: "thinking" }] },
        { type: "message", role: "user", content: [{ type: "input_image", file_id: "file-abc" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "hi" }] },
      ],
    });
    const asst = out.messages.find((m) => m.role === "assistant");
    expect(asst.reasoning_content).toBe("thinking");
  });

  it("drops a function_call_output whose call was never emitted", () => {
    const out = R2O({
      input: [
        { type: "function_call", call_id: "c1", name: "", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "ok" },
      ],
    });
    expect(out.messages.some((m) => m.role === "tool")).toBe(false);
  });

  it("keeps a function_call_output whose call was emitted", () => {
    const out = R2O({
      input: [
        { type: "function_call", call_id: "c1", name: "f", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "ok" },
      ],
    });
    expect(out.messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id)).toEqual(["c1"]);
  });
});

describe("OpenAI → Codex Responses (reverse)", () => {
  it("maps developer messages to Responses API instructions", () => {
    const out = O2R({
      messages: [
        { role: "developer", content: "Follow the project rules." },
        { role: "user", content: "Hello" },
      ],
    });

    expect(out.instructions).toBe("Follow the project rules.");
    expect(out.input).toEqual([
      { type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] },
    ]);
  });

  it("call_id longer than 64 chars is clamped", () => {
    const longId = "call_" + "x".repeat(80);
    const out = O2R({
      messages: [
        { role: "assistant", content: null, tool_calls: [
          { id: longId, type: "function", function: { name: "f", arguments: "{}" } },
        ] },
        { role: "tool", tool_call_id: longId, content: "ok" },
      ],
    });
    const fc = out.input.find((i) => i.type === "function_call");
    expect(fc.call_id.length).toBeLessThanOrEqual(64);
  });

  it("maps Chat Completions max_tokens to Responses max_output_tokens", () => {
    const out = O2R({
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
    });

    expect(out.max_output_tokens).toBe(1024);
    expect(out).not.toHaveProperty("max_tokens");
  });
});

describe("Codex Responses → Codex Responses normalization", () => {
  it("wraps a single message content object in an array", () => {
    const content = { type: "input_text", text: "Hello" };
    const out = R2R({
      input: [
        { role: "developer", content: "Follow the rules." },
        { role: "user", content },
      ],
    });

    expect(out.input[1].content).toEqual([content]);
  });

  it("preserves valid string and array message content", () => {
    const content = [{ type: "input_text", text: "Hello" }];
    const out = R2R({
      input: [
        { role: "developer", content: "Follow the rules." },
        { role: "user", content },
      ],
    });

    expect(out.input[0].content).toBe("Follow the rules.");
    expect(out.input[1].content).toEqual(content);
  });
});
