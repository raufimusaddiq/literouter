import { describe, it, expect } from "bun:test";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import antigravityRegistry from "../../open-sse/providers/registry/antigravity.js";
import geminiRegistry from "../../open-sse/providers/registry/gemini.js";
import { MODEL_PRICING } from "../../open-sse/providers/pricing.js";

const VERSIONS = [
  { version: "3.7", previous: "3.6", antigravityHasBase: false, title: "Gemini 3.7 Flash Support & Config (#3286, #3281)" },
  { version: "3.8", previous: "3.7", antigravityHasBase: true, title: "Gemini 3.8 Flash Support & Config" },
];

describe.each(VERSIONS)("$title", ({ version, previous, antigravityHasBase }) => {
  it(`registers gemini-${version}-flash tiered models in antigravity provider registry`, () => {
    const agIds = antigravityRegistry.models.map(m => m.id);
    expect(agIds).toContain(`gemini-${version}-flash-high`);
    expect(agIds).toContain(`gemini-${version}-flash-medium`);
    expect(agIds).toContain(`gemini-${version}-flash-low`);
    if (antigravityHasBase) expect(agIds).toContain(`gemini-${version}-flash`);
    else expect(agIds).not.toContain(`gemini-${version}-flash`);
  });

  it(`registers gemini-${version}-flash in gemini provider registry`, () => {
    const geminiIds = geminiRegistry.models.map(m => m.id);
    expect(geminiIds).toContain(`gemini-${version}-flash`);
  });

  it(`resolves capabilities correctly for gemini-${version} models with official limits`, () => {
    const caps = getCapabilitiesForModel("antigravity", `gemini-${version}-flash-high`);
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("gemini-level");
    expect(caps.contextWindow).toBe(1048576);
    expect(caps.maxOutput).toBe(65536);
  });

  it(`defines pricing matching gemini-${previous}-flash baseline`, () => {
    expect(MODEL_PRICING[`gemini-${version}-flash`]).toEqual(MODEL_PRICING[`gemini-${previous}-flash`]);
    expect(MODEL_PRICING[`gemini-${version}-flash-high`]).toEqual(MODEL_PRICING[`gemini-${previous}-flash-high`]);
    expect(MODEL_PRICING[`gemini-${version}-flash-medium`]).toEqual(MODEL_PRICING[`gemini-${previous}-flash-medium`]);
    expect(MODEL_PRICING[`gemini-${version}-flash-low`]).toEqual(MODEL_PRICING[`gemini-${previous}-flash-low`]);
  });
});
