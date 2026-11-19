// Pricing + capability rows for the models this intake introduces or exposes.
// Closes the "routes but bills $0" gap: every advertised id has an explicit row.
import { describe, expect, it } from "vitest";

import { getPricingForModel, setRuntimePricing, clearRuntimePricing } from "../../open-sse/providers/pricing.js";
import { getCapabilitiesForModel, DEFAULT_CAPABILITIES } from "../../open-sse/providers/capabilities.js";
import { noteUntrackedModel, resetUntrackedModelWarnings } from "../../open-sse/providers/trackingGaps.js";
import { parseCommandCodePricing } from "../../open-sse/services/commandcodeModels.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

const staticIds = (providerId) =>
  (REGISTRY.find((entry) => entry.id === providerId)?.models || []).map((m) => m.id);

describe("synthetic pricing", () => {
  // Source: https://synthetic.new/pricing/models (usage-based column) and the
  // per-token figures in GET https://api.synthetic.new/openai/v1/models.
  it("prices the datacenter models at the vendor's usage-based rate", () => {
    expect(getPricingForModel("synthetic", "hf:zai-org/GLM-5.3")).toMatchObject({ input: 1.4, output: 4.4, cached: 0.26 });
    expect(getPricingForModel("synthetic", "hf:zai-org/GLM-5.3-Flash")).toMatchObject({ input: 0.15, output: 0.5, cached: 0.04 });
    expect(getPricingForModel("synthetic", "hf:zai-org/GLM-4.7-Flash")).toMatchObject({ input: 0.1, output: 0.5, cached: 0.02 });
    expect(getPricingForModel("synthetic", "hf:moonshotai/Kimi-K3.1-Pro")).toMatchObject({ input: 2, output: 10, cached: 0.2 });
    expect(getPricingForModel("synthetic", "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017")).toMatchObject({ input: 0.6, output: 1.2, cached: 0.03 });
    expect(getPricingForModel("synthetic", "hf:Qwen/Qwen3.8-27B")).toMatchObject({ input: 0.45, output: 2.2, cached: 0.09 });
    expect(getPricingForModel("synthetic", "hf:openai/gpt-oss-120b")).toMatchObject({ input: 0.1, output: 0.1, cached: 0.02 });
  });

  it("has a row for every static registry id (zero + TODO where unpublished)", () => {
    for (const id of staticIds("synthetic")) {
      expect(getPricingForModel("synthetic", id), id).not.toBeNull();
    }
  });
});

describe("sensenova-intl pricing + capabilities", () => {
  it("keeps every intl chat model priced (explicit zero until the vendor publishes)", () => {
    for (const id of staticIds("sensenova-intl")) {
      expect(getPricingForModel("sensenova-intl", id), id).toMatchObject({ input: 0, output: 0 });
    }
  });

  it("uses the intl endpoint limits", () => {
    for (const id of staticIds("sensenova-intl")) {
      expect(getCapabilitiesForModel("sensenova-intl", id), id).toMatchObject({
        vision: true, reasoning: true, tools: true, thinkingFormat: "openai",
        contextWindow: 262144, maxOutput: 65536,
      });
    }
  });
});

describe("Claude live-catalog rows", () => {
  it("prices the new Claude ids the OAuth catalog advertises", () => {
    // Source: https://www.anthropic.com/pricing
    expect(getPricingForModel("claude", "claude-sonnet-5-5")).toMatchObject({ input: 2, output: 10, cached: 0.1, cache_creation: 2.5 });
    expect(getPricingForModel("claude", "claude-sonnet-5")).toMatchObject({ input: 2, output: 10, cached: 0.2 });
    expect(getPricingForModel("claude", "claude-opus-5-5")).toMatchObject({ input: 4, output: 20, cached: 0.2, cache_creation: 5 });
  });

  it("gives them the 1M adaptive-thinking capabilities", () => {
    for (const id of ["claude-sonnet-5-5", "claude-sonnet-5", "claude-opus-5-5"]) {
      expect(getCapabilitiesForModel("claude", id), id).toMatchObject({
        vision: true, reasoning: true, tools: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000,
      });
    }
  });
});

describe("CommandCode live catalog pricing", () => {
  const payload = { data: [{ id: "stepfun/Step-3.5-Flash", pricing: { inputCost: 0.1, outputCost: 0.3, cacheReadCost: 0.02, cacheWriteCost: 0.125 } }] };

  it("maps vendor rates into the pricing shape", () => {
    expect(parseCommandCodePricing(payload)["stepfun/Step-3.5-Flash"]).toEqual({
      input: 0.1, output: 0.3, cached: 0.02, cache_creation: 0.125, reasoning: 0.3,
    });
  });

  it("prices an id the static tables miss, then forgets it", () => {
    const unknown = "stepfun/Some-Future-Flash";
    expect(getPricingForModel("commandcode", unknown)).toBeNull();
    setRuntimePricing("commandcode", { [unknown]: { input: 0.5, output: 1.5, cached: 0.05, reasoning: 1.5 } });
    expect(getPricingForModel("commandcode", unknown)).toMatchObject({ input: 0.5, output: 1.5 });
    clearRuntimePricing("commandcode");
    expect(getPricingForModel("commandcode", unknown)).toBeNull();
  });

  it("covers every static registry id", () => {
    for (const id of staticIds("commandcode")) {
      expect(getPricingForModel("commandcode", id), id).not.toBeNull();
    }
  });

  it("skips hidden entries and rows without a price", () => {
    expect(parseCommandCodePricing({ data: [{ id: "a", hidden: true, pricing: { inputCost: 1, outputCost: 2 } }, { id: "b" }] })).toEqual({});
  });
});

describe("tracking gap warning", () => {
  it("warns once per unknown id and stays silent for catalogued ids", () => {
    resetUntrackedModelWarnings();
    const lines = [];
    const original = console.warn;
    console.warn = (line) => lines.push(line);
    try {
      noteUntrackedModel("synthetic", "hf:someone/unreleased-model", "cost");
      noteUntrackedModel("synthetic", "hf:someone/unreleased-model", "cost");
      noteUntrackedModel("synthetic", "hf:zai-org/GLM-5.3", "cost");
    } finally {
      console.warn = original;
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("hf:someone/unreleased-model");
    expect(lines[0]).not.toMatch(/sk-|Bearer/);
  });

  it("still routes an uncatalogued id at the default floor", () => {
    const caps = getCapabilitiesForModel("synthetic", "hf:someone/unreleased-model");
    expect(caps.contextWindow).toBe(DEFAULT_CAPABILITIES.contextWindow);
    expect(caps.tools).toBe(true);
  });
});
