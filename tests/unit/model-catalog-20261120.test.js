import { describe, expect, it } from "bun:test";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getCapabilitiesForModel as getCapabilities } from "../../open-sse/providers/capabilities.js";
import openai from "../../open-sse/providers/registry/openai.js";
import gemini from "../../open-sse/providers/registry/gemini.js";

describe("2026-11-20 model catalog pricing", () => {
  it.each([
    ["gpt-6.2-astra", 8, 40, 0.4, 10],
    ["gpt-6.2-sol", 2, 10, 0.1, 2.5],
    ["gpt-6.1-terra", 1, 5, 0.05, 1.25],
    ["gpt-6-astra", 10, 50, 1, 12.5],
    ["gpt-6-sol", 2, 10, 0.2, 2.5],
    ["gpt-6-luna", 0.1, 0.5, 0.01, 0.125],
    ["gpt-5.6-sol", 4, 20, 0.4, 5],
  ])("%p", (model, input, output, cached, cache_creation) => {
    expect(getPricingForModel("openai", model)).toMatchObject({ input, output, cached, cache_creation });
  });

  it.each([
    ["gemini-4-carbon", 4, 20, 0.2],
    ["gemini-4-argon", 4, 20, 0.2],
    ["gemini-4-neon", 3, 15, 0.15],
    ["gemini-4-hydrogen", 1.5, 7.5, 0.075],
  ])("%p", (model, input, output, cached) => {
    expect(getPricingForModel("gemini", model)).toMatchObject({ input, output, cached });
  });

  it.each([
    ["hy4", 0.834, 2.501, 0.042],
    ["hy4-preview", 0.834, 2.501, 0.042],
    ["hy4-flash", 0.07, 0.281, 0.003],
  ])("%p", (model, input, output, cached) => {
    expect(getPricingForModel("codebuddy-cn", model)).toMatchObject({ input, output, cached });
  });

  it("bills deepseek-flash and deepseek-v4-pro at the current official rate", () => {
    expect(getPricingForModel("deepseek", "deepseek-flash")).toMatchObject({ input: 0.15, output: 0.6, cached: 0.003 });
    expect(getPricingForModel("deepseek", "deepseek-v4-pro")).toMatchObject({ input: 0.66, output: 1.98, cached: 0.022 });
  });

  it("bills grok-4.7 and glm-5.3 at the current official rate", () => {
    expect(getPricingForModel("xai", "grok-4.7")).toMatchObject({ input: 2, output: 6, cached: 0.5 });
    expect(getPricingForModel("glm", "glm-5.3")).toMatchObject({ input: 1.4, output: 4.4, cached: 0.26 });
  });
});

describe("2026-11-20 model catalog capabilities and registry", () => {
  it("exposes gpt-6.2 on openai and gemini-4 on gemini", () => {
    const ids = (p) => p.models.map((m) => m.id);
    expect(ids(openai)).toEqual(expect.arrayContaining(["gpt-6.2-astra", "gpt-6.2-sol", "gpt-6.1-terra"]));
    expect(ids(gemini)).toEqual(expect.arrayContaining(["gemini-4-carbon", "gemini-4-neon", "gemini-4-hydrogen", "gemini-4-argon"]));
  });

  it("publishes the official windows", () => {
    expect(getCapabilities("openai", "gpt-6.2-astra")).toMatchObject({ vision: true, reasoning: true, contextWindow: 1050000, maxOutput: 128000 });
    expect(getCapabilities("gemini", "gemini-4-neon")).toMatchObject({ vision: true, reasoning: true, thinkingFormat: "gemini-level", contextWindow: 1048576, maxOutput: 65536 });
    expect(getCapabilities("tencent", "hy4")).toMatchObject({ vision: true, reasoning: true, contextWindow: 1000000, maxOutput: 64000 });
  });
});
