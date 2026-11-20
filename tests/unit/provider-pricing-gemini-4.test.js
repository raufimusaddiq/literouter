import { describe, expect, it } from "vitest";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

describe("gemini-4 pricing", () => {
  it("bills the Carbon/Argon tiers at their real rate", () => {
    for (const model of [
      "gemini-4-carbon",
      "gemini-4-carbon-high",
      "gemini-4-carbon-medium",
      "gemini-4-carbon-low",
      "gemini-4-argon",
    ]) {
      expect(getPricingForModel("antigravity", model)).toMatchObject({
        input: 4.00,
        output: 20.00,
        cached: 0.20,
      });
    }
  });

  it("strips the vendor prefix before matching", () => {
    expect(getPricingForModel("commandcode", "google/gemini-4-carbon").output).toBe(20.00);
  });
});
