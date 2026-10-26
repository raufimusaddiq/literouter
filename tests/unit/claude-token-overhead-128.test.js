// #128: does LiteRouter add input tokens to Claude requests? These tests pin the
// verified answer for each candidate, so the numbers are reproducible in CI and a
// change that alters them shows up as a failure rather than a silent cost.
import { describe, it, expect } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  anchorClaudeCache,
  normalizeClaudePassthrough,
  prepareClaudeRequest,
} from "../../open-sse/translator/formats/claude.js";
import { detectClientTool, isNativePassthrough } from "../../open-sse/utils/clientDetector.js";

const MODEL = "claude-sonnet-5-5";
const OAUTH = { accessToken: "sk-ant-oat01-test" };
const API_KEY = { apiKey: "sk-ant-api03-test" };
const DECOY_DESCRIPTION = "This tool is currently unavailable.";

const fn = (name) => ({ type: "function", function: { name, description: "d", parameters: { type: "object", properties: {} } } });
const text = (t) => ({ type: "text", text: t });
const tool = (name) => ({ name, description: "d", input_schema: { type: "object", properties: {} } });
const use = (id) => ({ role: "assistant", content: [text("Reading."), { type: "tool_use", id, name: "read_file", input: { path: "a" } }] });
const result = (id) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "file" }] });

const toClaude = (source, body, credentials) =>
  translateRequest(source, FORMATS.CLAUDE, MODEL, body, true, credentials, "claude", null, [], "conn-128", null);
const decoys = (body) => (body.tools || []).filter((t) => t.description === DECOY_DESCRIPTION);

function markers(body) {
  const out = [];
  (body.system || []).forEach((b, i) => b?.cache_control && out.push(`system[${i}]`));
  (body.tools || []).forEach((t, i) => t?.cache_control && out.push(`tools[${i}]`));
  (body.messages || []).forEach((m, i) => Array.isArray(m?.content) && m.content.forEach((b, j) => b?.cache_control && out.push(`messages[${i}].${j}`)));
  return out;
}

describe("#128 candidate 1: decoy tool schemas", () => {
  it("adds 20 stubs (2417 bytes of JSON) to a translated OAuth request with tools", () => {
    const out = toClaude(FORMATS.OPENAI, { messages: [{ role: "user", content: "hi" }], tools: [fn("get_weather")] }, OAUTH);
    const stubs = decoys(out);
    expect(stubs).toHaveLength(20);
    expect(JSON.stringify(stubs).length).toBe(2417);
    expect(out.tools).toHaveLength(21);
  });

  it("are appended after the tools-level 1h breakpoint, not before it", () => {
    const out = toClaude(FORMATS.OPENAI, { messages: [{ role: "user", content: "hi" }], tools: [fn("get_weather")] }, OAUTH);
    expect(out.tools.findIndex((t) => t.cache_control)).toBe(0);
    expect(decoys(out).every((t) => !t.cache_control)).toBe(true);
  });

  it("are not added for an API key", () => {
    const out = toClaude(FORMATS.OPENAI, { messages: [{ role: "user", content: "hi" }], tools: [fn("get_weather")] }, API_KEY);
    expect(decoys(out)).toHaveLength(0);
  });

  it("are not added to a request without tools", () => {
    const out = toClaude(FORMATS.OPENAI, { messages: [{ role: "user", content: "hi" }] }, OAUTH);
    expect(out.tools).toBeUndefined();
  });

  it("never reach Claude Code: its requests take the native passthrough, which skips translateRequest", () => {
    const client = detectClientTool({ "user-agent": "claude-cli/2.1.295 (external, cli)", "x-app": "cli" }, {});
    expect(client).toBe("claude");
    expect(isNativePassthrough(client, "claude")).toBe(true);
  });
});

describe("#128 candidate 2: context-management beta", () => {
  const contextManagement = { edits: [{ type: "clear_tool_uses_20250919" }] };

  it("forwards the client's context_management unchanged on the Claude Code passthrough", () => {
    const body = { model: MODEL, context_management: structuredClone(contextManagement), messages: [{ role: "user", content: "hi" }] };
    normalizeClaudePassthrough(body, MODEL);
    anchorClaudeCache(body);
    expect(body.context_management).toEqual(contextManagement);
  });

  it("forwards it unchanged on the translated Claude-format path", () => {
    const body = { context_management: structuredClone(contextManagement), messages: [{ role: "user", content: "hi" }] };
    expect(toClaude(FORMATS.CLAUDE, body, OAUTH).context_management).toEqual(contextManagement);
  });

  it("is never invented for a client that did not send it", () => {
    const out = toClaude(FORMATS.OPENAI, { messages: [{ role: "user", content: "hi" }] }, OAUTH);
    expect(out.context_management).toBeUndefined();
  });
});

describe("#128 candidate 3: cache_control budget", () => {
  const longLoop = (turns) => {
    const messages = [{ role: "user", content: [text("Fix the bug.")] }];
    for (let i = 0; i < turns; i++) messages.push(use(`t${i}`), result(`t${i}`));
    return { model: MODEL, max_tokens: 1024, system: [text("You are an agent.")], tools: [tool("read_file")], messages };
  };

  it("anchors the tail of a long history: only the final tool results sit past the last assistant breakpoint", () => {
    const out = prepareClaudeRequest(longLoop(40), "claude");
    const last = out.messages.length - 1;
    expect(markers(out)).toEqual(["system[0]", "tools[0]", `messages[${last - 1}].1`, `messages[${last}].0`]);
  });

  it("trims an over-budget client to 4 by dropping the earliest message markers, not the tail", () => {
    const body = longLoop(6);
    for (const msg of body.messages) msg.content[msg.content.length - 1].cache_control = { type: "ephemeral" };
    anchorClaudeCache(body);
    const last = body.messages.length - 1;
    expect(markers(body)).toEqual(["system[0]", "tools[0]", `messages[${last - 1}].1`, `messages[${last}].0`]);
  });
});
