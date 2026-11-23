
import { describe, it, expect } from "vitest";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

function makeBody(tools) {
  return {
    model: "deepseek-v4-pro",
    max_tokens: 1024,
    messages: [{ role: "user", content: "hello" }],
    tools,
  };
}

describe("prepareClaudeRequest — provider: deepseek", () => {
  it("declares the supportedTypes quirk on the provider transport", () => {
    expect(PROVIDERS.deepseek).toBeDefined();
    expect(PROVIDERS.deepseek.quirks).toBeDefined();
    expect(PROVIDERS.deepseek.quirks.claudeSupportedToolTypes).toEqual([
      "web_search_20250305",
      "web_search_20260209",
    ]);
  });

  it("strips MCP / custom tools (the regression) before forwarding", () => {
    const body = makeBody([
      { type: "custom", name: "Bash", input_schema: { type: "object" } },
      { type: "custom", name: "Read", input_schema: { type: "object" } },
      { type: "custom", name: "Glob", input_schema: { type: "object" } },
    ]);

    const out = prepareClaudeRequest(body, "deepseek");

    expect(out.tools).toBeUndefined();
    expect(out.tool_choice).toBeUndefined();
  });

  it("keeps web_search_20250305 and web_search_20260209", () => {
    const out = prepareClaudeRequest(
      makeBody([
        { type: "web_search_20250305", name: "web_search" },
        { type: "web_search_20260209", name: "web_search" },
      ]),
      "deepseek"
    );

    expect(Array.isArray(out.tools)).toBe(true);
    expect(out.tools).toHaveLength(2);
    const types = out.tools.map(t => t.type).sort();
    expect(types).toEqual(["web_search_20250305", "web_search_20260209"]);
  });

  it("preserves the `type` field on web_search_* tools (DeepSeek requires it)", () => {
    const out = prepareClaudeRequest(
      makeBody([{ type: "web_search_20250305", name: "web_search" }]),
      "deepseek"
    );

    expect(out.tools[0].type).toBe("web_search_20250305");
    expect(out.tools[0].name).toBe("web_search");
  });

  it("drops `custom` but keeps `web_search_*` when both are present", () => {
    const out = prepareClaudeRequest(
      makeBody([
        { type: "custom", name: "Bash", input_schema: { type: "object" } },
        { type: "web_search_20250305", name: "web_search" },
      ]),
      "deepseek"
    );

    expect(Array.isArray(out.tools)).toBe(true);
    expect(out.tools).toHaveLength(1);
    expect(out.tools[0].type).toBe("web_search_20250305");
    expect(out.tools[0].name).toBe("web_search");
  });

  it("survives when body has no tools", () => {
    const out = prepareClaudeRequest(makeBody(undefined), "deepseek");
    expect(out.tools).toBeUndefined();
  });

  it("rejects future / unknown tool types instead of forwarding them", () => {
    const out = prepareClaudeRequest(
      makeBody([{ type: "future_tool_2099", name: "x" }]),
      "deepseek"
    );
    expect(out.tools).toBeUndefined();
  });
});

describe("prepareClaudeRequest — backward compat: providers without the quirk", () => {
  it("keeps prior behaviour (drop custom + web_search_*, normalize no-type tools)", () => {
    const candidate = Object.entries(PROVIDERS).find(
      ([id, p]) =>
        id !== "claude" &&
        p?.transports?.some(t => t.format === "claude") &&
        !p?.quirks?.claudeSupportedToolTypes
    );

    if (!candidate) {
      return;
    }

    const [providerId] = candidate;

    const out = prepareClaudeRequest(
      makeBody([
        { type: "custom", name: "Bash", input_schema: { type: "object" } },
        { type: "web_search_20250305", name: "web_search" },
        { name: "no_type_tool", input_schema: { type: "object" } },
      ]),
      providerId
    );

    if (out.tools !== undefined) {
      for (const t of out.tools) {
        expect(t.type).toBeUndefined();
      }
    }
  });
});