import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("Claude Sonnet 5.5 capabilities", () => {
  for (const model of ["claude-sonnet-5-5", "claude-sonnet-5.5", "anthropic/claude-sonnet-5-5"]) {
    it(`${model} resolves to adaptive thinking + 1M context`, () => {
      expect(getCapabilitiesForModel("claude", model)).toMatchObject({
        thinkingFormat: "claude-adaptive",
        contextWindow: 1000000,
        maxOutput: 128000,
        reasoning: true,
      });
    });
  }
});
