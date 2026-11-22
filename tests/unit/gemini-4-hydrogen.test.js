import { describe, expect, it } from "bun:test";

import { getModelUpstreamId, isValidModel } from "../../open-sse/config/providerModels.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking, stripThinkingSuffix } from "../../open-sse/translator/concerns/thinkingUnified.js";

const TIERS = ["gemini-4-hydrogen-xhigh", "gemini-4-hydrogen-high", "gemini-4-hydrogen-medium", "gemini-4-hydrogen-low"];

describe("Gemini 4 Hydrogen on Antigravity", () => {
  it.each([...TIERS, "gemini-4-hydrogen"])("registers %s with the Hydrogen profile", (model) => {
    expect(isValidModel("ag", model)).toBe(true);
    expect(getCapabilitiesForModel("antigravity", model)).toMatchObject({
      vision: true, pdf: true, reasoning: true, thinkingFormat: "gemini-level",
      thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65536,
    });
    expect(getThinkingLevels("antigravity", model)).toEqual(["low", "medium", "high", "xhigh"]);
    expect(getPricingForModel("antigravity", model)).toMatchObject({ input: 1.5, output: 7.5, cached: 0.075 });
  });

  it.each([
    ["gemini-4-hydrogen-xhigh", "xhigh"],
    ["gemini-4-hydrogen-high", "high"],
    ["gemini-4-hydrogen-medium", "medium"],
    ["gemini-4-hydrogen-low", "low"],
  ])("sends %s with thinkingLevel %s", (modelId, level) => {
    const upstreamModel = getModelUpstreamId("ag", modelId);
    expect(upstreamModel).toBe(`${modelId}(${level})`);
    const body = {
      model: stripThinkingSuffix(upstreamModel),
      request: { contents: [{ role: "user", parts: [{ text: "hello" }] }], generationConfig: {} },
    };
    applyThinking("antigravity", upstreamModel, body, "antigravity");
    const finalBody = new AntigravityExecutor().transformRequest(modelId, body, true, { projectId: "p", connectionId: "c" });
    expect(finalBody.request.generationConfig.thinkingConfig).toEqual({ thinkingLevel: level, includeThoughts: true });
  });

  it("downgrades xhigh to high on a Gemini 4 model without an xhigh tier", () => {
    const body = {
      model: "gemini-4-carbon",
      request: { contents: [{ role: "user", parts: [{ text: "hello" }] }], generationConfig: {} },
    };
    applyThinking("antigravity", "gemini-4-carbon(xhigh)", body, "antigravity");
    expect(body.request.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
  });
});
