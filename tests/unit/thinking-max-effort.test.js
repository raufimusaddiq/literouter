import { describe, expect, it } from "bun:test";
import { budgetToLevel } from "../../open-sse/translator/concerns/thinking.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const NODE = "openai-compatible-chat-test";
const MAX_MODELS = ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];

describe("budgetToLevel", () => {
  it.each([
    [98304, "max"],
    [128000, "max"],
    [80385, "max"],
    [80384, "xhigh"],
    [31999, "xhigh"],
  ])("budget %p maps to %p", (budget, level) => {
    expect(budgetToLevel(budget)).toBe(level);
  });
});

describe("applyThinking max effort", () => {
  it("maps a 98304 budget to max for gpt-5.6-sol on the codex responses wire", () => {
    const body = { thinking: { type: "enabled", budget_tokens: 98304 } };
    expect(applyThinking(FORMATS.OPENAI_RESPONSES, "gpt-5.6-sol", body, "codex")?.reasoning_effort).toBe("max");
  });

  it.each([
    ["client output_config.effort max", { output_config: { effort: "max" } }, "xhigh"],
    ["direct reasoning_effort max", { reasoning_effort: "max" }, "xhigh"],
    ["xhigh passes through", { reasoning_effort: "xhigh" }, "xhigh"],
    ["high passes through", { reasoning_effort: "high" }, "high"],
    ["a 128000 budget", { thinking: { type: "enabled", budget_tokens: 128000 } }, "xhigh"],
  ])("openai provider clamps %s to %p", (_label, body, expected) => {
    expect(applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai").reasoning_effort).toBe(expected);
  });

  describe("OpenAI Compatible node keeps effort max for GPT-5.6 / GPT-6 (#5186)", () => {
    it.each(MAX_MODELS)("%p: max reaches the wire as max (chat)", (model) => {
      expect(applyThinking(FORMATS.OPENAI, model, { reasoning_effort: "max" }, NODE).reasoning_effort).toBe("max");
    });

    it.each(MAX_MODELS)("%p: Claude-style output_config.effort max stays max", (model) => {
      expect(applyThinking(FORMATS.OPENAI, model, { output_config: { effort: "max" } }, NODE).reasoning_effort).toBe("max");
    });

    it("level list offers max for the picker", () => {
      expect(getThinkingLevels(NODE, "gpt-6-astra")).toContain("max");
    });

    it("older GPT models on a node keep the xhigh clamp", () => {
      expect(applyThinking(FORMATS.OPENAI, "gpt-5", { reasoning_effort: "max" }, NODE).reasoning_effort).toBe("xhigh");
    });
  });
});
