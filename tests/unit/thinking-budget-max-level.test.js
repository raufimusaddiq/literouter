import { describe, expect, it } from "vitest";
import { budgetToLevel } from "../../open-sse/translator/concerns/thinking.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("budgetToLevel reaches max tier", () => {
  it("budget 98304 → \"max\"", () => {
    expect(budgetToLevel(98304)).toBe("max");
  });

  it("budget 128000 → \"max\"", () => {
    expect(budgetToLevel(128000)).toBe("max");
  });

  it("budget 80385 → \"max\" (just above midpoint)", () => {
    expect(budgetToLevel(80385)).toBe("max");
  });

  it("budget 80384 → \"xhigh\" (midpoint still xhigh)", () => {
    expect(budgetToLevel(80384)).toBe("xhigh");
  });

  it("budget 31999 stays \"xhigh\"", () => {
    expect(budgetToLevel(31999)).toBe("xhigh");
  });
});

describe("applyThinking (openai-responses): large budgets map to max effort", () => {
  it("budget 98304 → reasoning_effort \"max\" for gpt-5.6-sol (openai wire)", () => {
    const body = { thinking: { type: "enabled", budget_tokens: 98304 } };
    const out = applyThinking(FORMATS.OPENAI_RESPONSES, "gpt-5.6-sol", body, "codex");
    expect(out?.reasoning_effort).toBe("max");
  });
});
