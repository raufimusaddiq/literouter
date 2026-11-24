import { describe, expect, it } from "bun:test";

import { getModelUpstreamId, isValidModel } from "../../open-sse/config/providerModels.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking, stripThinkingSuffix } from "../../open-sse/translator/concerns/thinkingUnified.js";

const tiers = (base, levels) => [...levels.map((level) => `${base}-${level}`), base];
const ARGON = tiers("gemini-4-argon", ["high", "medium", "low"]);
const NEON = tiers("gemini-4-neon", ["xhigh", "high", "medium", "low"]);
const SONNET = tiers("claude-sonnet-5-5", ["max", "high", "medium", "low"]);
const OPUS = tiers("claude-opus-5-5", ["max", "high", "medium", "low"]);

const GEMINI_4 = ["low", "medium", "high"];
const GEMINI_4_XHIGH = ["low", "medium", "high", "xhigh"];
const AG_CLAUDE_5_5 = ["low", "medium", "high", "max"];

function wireThinking(modelId) {
  const upstreamModel = getModelUpstreamId("ag", modelId);
  const wireModel = stripThinkingSuffix(upstreamModel);
  const body = {
    model: wireModel,
    request: { contents: [{ role: "user", parts: [{ text: "hello" }] }], generationConfig: {} },
  };
  applyThinking("antigravity", upstreamModel, body, "antigravity");
  const finalBody = new AntigravityExecutor().transformRequest(wireModel, body, true, { projectId: "p", connectionId: "c" });
  return { wireModel: finalBody.model, thinkingConfig: finalBody.request.generationConfig.thinkingConfig, finalBody };
}

describe("Antigravity Gemini 4 Argon/Neon and Claude 5.5 catalog", () => {
  it.each([
    ...ARGON.map((id) => [id, GEMINI_4, { input: 4, output: 20, cached: 0.2 }]),
    ...NEON.map((id) => [id, GEMINI_4_XHIGH, { input: 3, output: 15, cached: 0.15 }]),
    ...SONNET.map((id) => [id, AG_CLAUDE_5_5, { input: 2, output: 10, cached: 0.1, cache_creation: 2.5 }]),
    ...OPUS.map((id) => [id, AG_CLAUDE_5_5, { input: 4, output: 20, cached: 0.2, cache_creation: 5 }]),
  ])("registers %s with its thinking levels, capabilities and list price", (id, levels, price) => {
    expect(isValidModel("ag", id)).toBe(true);
    expect(getThinkingLevels("antigravity", id)).toEqual(levels);
    expect(getThinkingLevels("ag", id)).toEqual(levels);
    expect(getCapabilitiesForModel("antigravity", id)).toMatchObject({ vision: true, reasoning: true });
    expect(getPricingForModel("antigravity", id)).toMatchObject(price);
  });

  it.each([
    ["gemini-4-argon", "gemini-4-argon-high", "high"],
    ["gemini-4-argon-low", "gemini-4-argon-low", "low"],
    ["gemini-4-neon", "gemini-4-neon-high", "high"],
    ["gemini-4-neon-xhigh", "gemini-4-neon-xhigh", "xhigh"],
    ["claude-sonnet-5-5", "claude-sonnet-5-5-medium", "medium"],
    ["claude-sonnet-5-5-max", "claude-sonnet-5-5-max", "max"],
    ["claude-opus-5-5", "claude-opus-5-5-medium", "medium"],
    ["claude-opus-5-5-low", "claude-opus-5-5-low", "low"],
  ])("sends %s as %s with thinkingLevel %s", (id, wire, level) => {
    const { wireModel, thinkingConfig, finalBody } = wireThinking(id);
    expect(wireModel).toBe(wire);
    expect(thinkingConfig).toEqual({ thinkingLevel: level, includeThoughts: true });
    expect(finalBody.thinking).toBeUndefined();
    expect(finalBody.output_config).toBeUndefined();
  });

  it.each([
    ["gemini-4-neon(max)", "xhigh"],
    ["gemini-4-hydrogen(max)", "xhigh"],
    ["gemini-4-argon(max)", "high"],
    ["gemini-4-carbon(xhigh)", "high"],
    ["gemini-4-neon(none)", "low"],
    ["gemini-4-carbon(none)", "low"],
  ])("maps %s to thinkingLevel %s", (model, level) => {
    const body = { request: { contents: [], generationConfig: {} } };
    applyThinking("antigravity", model, body, "antigravity");
    expect(body.request.generationConfig.thinkingConfig.thinkingLevel).toBe(level);
  });

  it("keeps Claude 4.6 on Antigravity off the Gemini thinking config", () => {
    const body = { request: { contents: [], generationConfig: {} } };
    applyThinking("antigravity", "claude-sonnet-4-6(high)", body, "antigravity");
    expect(body.request.generationConfig.thinkingConfig).toBeUndefined();
  });
});
