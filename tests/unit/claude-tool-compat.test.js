import { describe, expect, it } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";
import { initState, translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
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

describe("Claude-native named tool_choice", () => {
  it("sanitizes the name so it matches the rewritten declaration", () => {
    const out = build({ tools: [fn("mcp.srv.list")], tool_choice: { type: "tool", name: "mcp.srv.list" } });
    const alias = out.tools[0].name;
    expect(alias).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(out.tool_choice).toEqual({ type: "tool", name: alias });
  });
});

// Runs the production translator state; each emitted chunk is cloned because the
// first tool-call chunk shares its mutable object with the state.
function streamToolArguments(events) {
  const state = initState(FORMATS.OPENAI);
  const out = [];
  for (const ev of events) {
    const r = claudeToOpenAIResponse(ev, state);
    for (const chunk of Array.isArray(r) ? r : [r]) if (chunk) out.push(structuredClone(chunk));
  }
  return out.flatMap((c) => c.choices?.[0]?.delta?.tool_calls || []).map((tc) => tc.function?.arguments || "").join("");
}

const START = { type: "message_start", message: { id: "m", model: "claude", role: "assistant", content: [], usage: { input_tokens: 1, output_tokens: 0 } } };

describe("Claude streaming no-argument tool call", () => {
  it("completes arguments with {} when no input_json_delta arrives", () => {
    const args = streamToolArguments([
      START,
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "ping", input: {} } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ]);
    expect(JSON.parse(args)).toEqual({});
  });

  it("does not append to arguments that were streamed", () => {
    const args = streamToolArguments([
      START,
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "get_weather", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"city\":\"Paris\"}" } },
      { type: "content_block_stop", index: 0 },
    ]);
    expect(args).toBe("{\"city\":\"Paris\"}");
  });
});

describe("Claude OAuth cloaking keeps the original tool name", () => {
  it("restores a dotted MCP name through sanitizing and cloaking", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
      tools: [fn("mcp.srv.list")],
    };
    const out = translateRequest(
      FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-5-5", body, true,
      { accessToken: "sk-ant-oat01-test" }, "claude", null, [], "conn-test", null,
    );
    const declared = out.tools.find((tool) => tool.name?.startsWith("mcp"))?.name;
    expect(declared).toBeTruthy();
    expect(declared).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(out._toolNameMap.get(declared)).toBe("mcp.srv.list");

    // Response side: the model calls the declared (cloaked) name; the client must see its own.
    const state = { ...initState(FORMATS.OPENAI), toolNameMap: out._toolNameMap };
    const chunks = [
      { type: "message_start", message: { id: "m", model: "claude", role: "assistant", content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: declared, input: {} } },
    ].flatMap((ev) => { const r = claudeToOpenAIResponse(ev, state); return Array.isArray(r) ? r : [r]; });
    const names = chunks.flatMap((c) => c?.choices?.[0]?.delta?.tool_calls || []).map((tc) => tc.function?.name);
    expect(names).toContain("mcp.srv.list");
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

  it("switches disabled thinking to adaptive with low effort when the model requires adaptive", () => {
    const body = { thinking: { type: "disabled" }, output_config: { format: "x" } };
    const next = adaptClaudeRequestAfterRejection(
      body,
      reject('"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.'),
    );
    expect(next.thinking).toEqual({ type: "adaptive" });
    expect(next.output_config).toEqual({ format: "x", effort: "low" });
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("returns null for unrelated errors or when nothing applies", () => {
    expect(adaptClaudeRequestAfterRejection({ tool_choice: { type: "any" } }, reject("max_tokens too large"))).toBeNull();
    expect(adaptClaudeRequestAfterRejection({ tool_choice: { type: "auto" } }, reject('tool_choice: type "any" not supported for this model'))).toBeNull();
  });
});
