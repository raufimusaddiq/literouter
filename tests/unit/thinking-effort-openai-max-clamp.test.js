import { describe, expect, it } from "bun:test";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("applyThinking (openai): clamp max effort to xhigh", () => {
  it.each([
    ["client output_config.effort max maps to reasoning_effort xhigh (not max)", { output_config: { effort: "max" } }, "xhigh"],
    ["direct reasoning_effort max is clamped to xhigh", { reasoning_effort: "max" }, "xhigh"],
    ["xhigh passes through unchanged (highest valid OpenAI level)", { reasoning_effort: "xhigh" }, "xhigh"],
    ["high passes through unchanged", { reasoning_effort: "high" }, "high"],
    ["max budget (thinking.budget_tokens 128000) maps to xhigh (budgetToLevel caps at xhigh)", { thinking: { type: "enabled", budget_tokens: 128000 } }, "xhigh"],
  ])("%s", (_label, body, expected) => {
    const out = applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai");
    expect(out.reasoning_effort).toBe(expected);
  });
});
