import { describe, it, expect } from "bun:test";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const chunk = (overrides) => ({
  id: "chatcmpl-stream-flush",
  model: "test-model",
  choices: [{ index: 0, delta: {}, finish_reason: null }],
  ...overrides,
});

const types = (events) => events.map((e) => e.type);

describe("openaiToClaudeResponse stream completion", () => {
  it("closes the message on the null flush when upstream never sent finish_reason", () => {
    const state = { ...initState(FORMATS.CLAUDE), targetFormat: FORMATS.OPENAI };

    openaiToClaudeResponse(chunk({ choices: [{ delta: { content: "hi" } }] }), state);
    const events = openaiToClaudeResponse(null, state);

    expect(types(events)).toEqual(["content_block_stop", "message_delta", "message_stop"]);
    expect(events[1].delta.stop_reason).toBe("end_turn");
  });

  it("flushes buffered tool input before stopping on the null flush", () => {
    const state = { ...initState(FORMATS.CLAUDE), targetFormat: FORMATS.OPENAI };

    openaiToClaudeResponse(chunk({
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "Read", arguments: '{"file_path":"a"}' } }] } }],
    }), state);
    const events = openaiToClaudeResponse(null, state);

    const delta = events.find((e) => e.delta?.type === "input_json_delta");
    expect(JSON.parse(delta.delta.partial_json)).toEqual({ file_path: "a" });
    expect(events.at(-1).type).toBe("message_stop");
    expect(events.find((e) => e.type === "message_delta").delta.stop_reason).toBe("tool_use");
  });

  it("waits for a trailing usage chunk and reports real usage", () => {
    const state = { ...initState(FORMATS.CLAUDE), targetFormat: FORMATS.OPENAI };

    openaiToClaudeResponse(chunk({ choices: [{ delta: { content: "hi" } }] }), state);
    const finishEvents = openaiToClaudeResponse(
      chunk({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      state
    );
    expect(types(finishEvents)).not.toContain("message_delta");

    const usageEvents = openaiToClaudeResponse({
      id: "chatcmpl-stream-flush",
      choices: [],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    }, state);

    const messageDelta = usageEvents.find((e) => e.type === "message_delta");
    expect(messageDelta.usage).toEqual({ input_tokens: 100, output_tokens: 20 });
    expect(types(usageEvents)).toContain("message_stop");
  });

  it("keeps a tool call whose first fragment has no id", () => {
    const state = { ...initState(FORMATS.CLAUDE), targetFormat: FORMATS.OPENAI };

    const started = openaiToClaudeResponse(chunk({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "Read", arguments: "" } }] } }],
    }), state);
    const block = started.find((e) => e.type === "content_block_start");
    expect(block.content_block.type).toBe("tool_use");
    expect(typeof block.content_block.id).toBe("string");
    expect(block.content_block.id.length).toBeGreaterThan(0);

    openaiToClaudeResponse(chunk({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"file_path":"a"}' } }] } }],
    }), state);
    const events = openaiToClaudeResponse(chunk({
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
    }), state);

    const delta = events.find((e) => e.delta?.type === "input_json_delta");
    expect(JSON.parse(delta.delta.partial_json)).toEqual({ file_path: "a" });
  });

  it("mints ids before cross-format translation", () => {
    const state = initState(FORMATS.CLAUDE);
    state.targetFormat = FORMATS.OPENAI;
    state.streamToolCallIds = new Map();

    const events = translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, chunk({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "Read", arguments: '{"file_path":"a"}' } }] } }],
    }), state);

    const block = events.find((e) => e.type === "content_block_start");
    expect(typeof block.content_block.id).toBe("string");
    expect(block.content_block.id.length).toBeGreaterThan(0);
  });
});
