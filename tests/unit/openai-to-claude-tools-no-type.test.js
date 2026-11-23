
import { describe, it, expect } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

const baseBody = (extra = {}) => ({
  messages: [{ role: "user", content: "hi" }],
  ...extra,
});

describe("openai→claude: tools shape fidelity", () => {
  it("tool WITH explicit type:'function' is rewritten to Anthropic shape", () => {
    const out = openaiToClaudeRequest("claude-sonnet-4.5", baseBody({
      tools: [
        { type: "function", function: { name: "echo", parameters: { type: "object" } } },
      ],
    }), false);

    expect(out.tools).toHaveLength(1);
    expect(out.tools[0].name).toBe("echo");
    expect(out.tools[0].input_schema).toEqual({ type: "object" });
    expect(out.tools[0]).not.toHaveProperty("type");
    expect(out.tools[0]).not.toHaveProperty("function");
  });

  it("tool WITHOUT explicit type but WITH function wrapper preserves the original name (was 'undefined' in v0.5.20)", () => {
    const out = openaiToClaudeRequest("claude-sonnet-4.5", baseBody({
      tools: [
        { function: { name: "echo", parameters: { type: "object" } } },
      ],
    }), false);

    expect(out.tools).toHaveLength(1);
    expect(out.tools[0].name).toBe("echo");
    expect(out.tools[0].input_schema).toEqual({ type: "object" });
    expect(out.tools[0]).not.toHaveProperty("function");
    expect(out.tools[0]).not.toHaveProperty("type");
  });

  it("flat Anthropic-shape tool (no function wrapper) is passed through with name preserved", () => {
    const out = openaiToClaudeRequest("claude-sonnet-4.5", baseBody({
      tools: [
        { name: "echo", description: "echo input", input_schema: { type: "object" } },
      ],
    }), false);

    expect(out.tools).toHaveLength(1);
    expect(out.tools[0].name).toBe("echo");
    expect(out.tools[0].description).toBe("echo input");
    expect(out.tools[0].input_schema).toEqual({ type: "object" });
  });

  it("non-function built-in tool types are passed through (cache_control tag is OK)", () => {
    const out = openaiToClaudeRequest("claude-sonnet-4.5", baseBody({
      tools: [
        { type: "web_search_20250305", name: "web_search" },
      ],
    }), false);

    expect(out.tools).toHaveLength(1);
    expect(out.tools[0].type).toBe("web_search_20250305");
    expect(out.tools[0].name).toBe("web_search");
  });
});
