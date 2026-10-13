import { describe, expect, it } from "vitest";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";

const fn = (name) => ({ type: "function", function: { name, description: "d", parameters: { type: "object", properties: {} } } });
const convert = (extra) => openaiToOpenAIResponsesRequest("gpt-6.1-sol", {
  messages: [{ role: "user", content: "hi" }],
  tools: [fn("get_weather"), fn("mcp__srv__list.items")],
  ...extra,
}, true, {});

describe("Chat tool_choice -> Responses", () => {
  it.each(["auto", "required", "none"])("forwards string tool_choice %s", (choice) => {
    expect(convert({ tool_choice: choice }).tool_choice).toBe(choice);
  });

  it("flattens a named function choice to the Responses shape", () => {
    expect(convert({ tool_choice: { type: "function", function: { name: "get_weather" } } }).tool_choice)
      .toEqual({ type: "function", name: "get_weather" });
  });

  it("forwards parallel_tool_calls and omits tool_choice when the client sent none", () => {
    const out = convert({ parallel_tool_calls: false });
    expect(out.parallel_tool_calls).toBe(false);
    expect(out.tool_choice).toBeUndefined();
  });
});

describe("Responses tool name sanitizing", () => {
  it("rewrites names outside [a-zA-Z0-9_-] consistently and records the mapping", () => {
    const out = convert({
      tool_choice: { type: "function", function: { name: "mcp__srv__list.items" } },
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "mcp__srv__list.items", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_1", content: "ok" },
      ],
    });
    const safe = out.tools[1].name;
    expect(safe).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(out.tool_choice).toEqual({ type: "function", name: safe });
    expect(out.input.find((item) => item.type === "function_call").name).toBe(safe);
    expect(out._toolNameMap.get(safe)).toBe("mcp__srv__list.items");
    expect(out.tools[0].name).toBe("get_weather");
  });

  it("keeps colliding sanitized names distinct", () => {
    const out = openaiToOpenAIResponsesRequest("gpt-6.1-sol", {
      messages: [{ role: "user", content: "hi" }],
      tools: [fn("a.b"), fn("a:b")],
    }, true, {});
    expect(new Set(out.tools.map((tool) => tool.name)).size).toBe(2);
    expect([...out._toolNameMap.values()].sort()).toEqual(["a.b", "a:b"]);
  });

  it("sets no mapping when every name is already valid", () => {
    const out = openaiToOpenAIResponsesRequest("gpt-6.1-sol", {
      messages: [{ role: "user", content: "hi" }],
      tools: [fn("get_weather")],
    }, true, {});
    expect(out._toolNameMap).toBeUndefined();
  });

  it.each([
    ["valid name declared first", ["a_b", "a.b"]],
    ["valid name declared last", ["a.b", "a_b"]],
  ])("never maps a real tool onto an alias: %s", (_label, names) => {
    const out = openaiToOpenAIResponsesRequest("gpt-6.1-sol", {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: null, tool_calls: [
          { id: "c1", type: "function", function: { name: "a_b", arguments: "{}" } },
          { id: "c2", type: "function", function: { name: "a.b", arguments: "{}" } },
        ] },
      ],
      tools: names.map(fn),
      tool_choice: { type: "function", function: { name: "a_b" } },
    }, true, {});
    const declared = out.tools.map((tool) => tool.name);
    expect(new Set(declared).size).toBe(2);
    expect(declared).toContain("a_b");
    const alias = declared.find((name) => name !== "a_b");
    expect(out._toolNameMap.get(alias)).toBe("a.b");
    expect(out._toolNameMap.has("a_b")).toBe(false);
    expect(out.tool_choice).toEqual({ type: "function", name: "a_b" });
    expect(out.input.filter((item) => item.type === "function_call").map((item) => item.name)).toEqual(["a_b", alias]);
  });
});
