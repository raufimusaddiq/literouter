import { describe, expect, it } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";
import { adaptClaudeRequestAfterRejection } from "../../open-sse/utils/claudeRequestFallback.js";

const fn = (name) => ({ type: "function", function: { name, description: "d", parameters: { type: "object", properties: {} } } });
const build = (extra) => openaiToClaudeRequest("claude-sonnet-5-5", {
  messages: [{ role: "user", content: "hi" }],
  tools: [fn("get_weather")],
  ...extra,
}, true);

describe("Chat tool_choice -> Claude", () => {
  it("maps none to Claude's none instead of auto", () => {
    expect(build({ tool_choice: "none" }).tool_choice).toEqual({ type: "none" });
  });

  it("keeps required and named choices", () => {
    expect(build({ tool_choice: "required" }).tool_choice).toEqual({ type: "any" });
    expect(build({ tool_choice: { type: "function", function: { name: "get_weather" } } }).tool_choice)
      .toEqual({ type: "tool", name: "get_weather" });
  });
});

describe("Claude tool name sanitizing", () => {
  it("rewrites dotted names in declarations, history and tool_choice, and records the mapping", () => {
    const out = build({
      tools: [fn("a_b"), fn("mcp.srv.list")],
      tool_choice: { type: "function", function: { name: "mcp.srv.list" } },
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "mcp.srv.list", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "c1", content: "ok" },
      ],
    });
    const names = out.tools.map((tool) => tool.name);
    const alias = names.find((name) => name !== "a_b");
    expect(alias).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(out.tool_choice).toEqual({ type: "tool", name: alias });
    const toolUse = out.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => b.type === "tool_use");
    expect(toolUse.name).toBe(alias);
    expect(out._toolNameMap.get(alias)).toBe("mcp.srv.list");
  });

  it("never maps a real valid tool onto an alias", () => {
    const out = build({ tools: [fn("a.b"), fn("a_b")] });
    const names = out.tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(2);
    expect(names).toContain("a_b");
    expect(out._toolNameMap.get("a_b")).toBe("a_b");
  });
});

describe("Claude streaming no-argument tool call", () => {
  it("completes arguments with {} when no input_json_delta arrives", () => {
    const state = {};
    const out = [];
    for (const ev of [
      { type: "message_start", message: { id: "m", model: "claude", role: "assistant", content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "ping", input: {} } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ]) {
      const r = claudeToOpenAIResponse(ev, state);
      if (Array.isArray(r)) out.push(...r);
      else if (r) out.push(r);
    }
    const args = out.flatMap((c) => c.choices?.[0]?.delta?.tool_calls || []).map((tc) => tc.function?.arguments || "").join("");
    expect(JSON.parse(args)).toEqual({});
  });

  it("does not append to arguments that were streamed", () => {
    const state = {};
    const out = [];
    for (const ev of [
      { type: "message_start", message: { id: "m", model: "claude", role: "assistant", content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "get_weather", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"city\":\"Paris\"}" } },
      { type: "content_block_stop", index: 0 },
    ]) {
      const r = claudeToOpenAIResponse(ev, state);
      if (Array.isArray(r)) out.push(...r);
      else if (r) out.push(r);
    }
    const args = out.flatMap((c) => c.choices?.[0]?.delta?.tool_calls || []).map((tc) => tc.function?.arguments || "").join("");
    expect(args).toBe("{\"city\":\"Paris\"}");
  });
});

describe("Claude request adaptation after a 400", () => {
  const reject = (message) => JSON.stringify({ type: "error", error: { type: "invalid_request_error", message } });

  it("falls back to auto when the model rejects forced tool_choice", () => {
    const body = { tool_choice: { type: "any" }, tools: [{ name: "x" }] };
    const next = adaptClaudeRequestAfterRejection(body, reject('tool_choice: type "tool" and "any" are not supported for this model.'));
    expect(next.tool_choice).toEqual({ type: "auto" });
    expect(body.tool_choice).toEqual({ type: "any" });
  });

  it("switches disabled thinking to between_tools when the model asks for it", () => {
    const next = adaptClaudeRequestAfterRejection(
      { thinking: { type: "disabled" } },
      reject('To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}.'),
    );
    expect(next.thinking).toEqual({ type: "between_tools" });
  });

  it("returns null for unrelated errors or when nothing applies", () => {
    expect(adaptClaudeRequestAfterRejection({ tool_choice: { type: "any" } }, reject("max_tokens too large"))).toBeNull();
    expect(adaptClaudeRequestAfterRejection({ tool_choice: { type: "auto" } }, reject('tool_choice: type "any" not supported for this model'))).toBeNull();
  });
});
