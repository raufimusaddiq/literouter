import { describe, expect, it } from "bun:test";

import { getPricingForModel, PROVIDER_PRICING } from "../../open-sse/providers/pricing.js";
import { PROVIDER_CAPABILITIES } from "../../open-sse/providers/capabilities.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

const staticIds = (providerId) =>
  (REGISTRY.find((entry) => entry.id === providerId)?.models || []).map((m) => m.id);

describe.each(["opendesign-go", "deeprelay"])("%s model tracking", (provider) => {
  it("has a pricing and a capability row for every static registry id", () => {
    const ids = staticIds(provider);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(Object.hasOwn(PROVIDER_PRICING[provider], id), id).toBe(true);
      expect(Object.hasOwn(PROVIDER_CAPABILITIES[provider], id), id).toBe(true);
    }
  });
});

describe("gateway pricing", () => {
  it.each([
    ["opendesign-go", "claude-opus-5.5", { input: 4, output: 20, cached: 0.2, cache_creation: 5 }],
    ["opendesign-go", "claude-haiku-5.5", { input: 0.1, output: 0.5, cached: 0.01 }],
    ["opendesign-go", "deepseek-v4.1-flash", { input: 0.3, output: 1.2, cached: 0.006 }],
    ["opendesign-go", "gpt-6-luna", { input: 0.1, output: 0.5, cached: 0.01 }],
    ["deeprelay", "deepseek-v4.1-flash", { input: 0.135, output: 0.54, cached: 0.0027 }],
    ["deeprelay", "kimi-k3.1-pro", { input: 2, output: 10, cached: 0.2 }],
    ["deeprelay", "glm-5.3", { input: 0.9, output: 2.83, cached: 0.167 }],
  ])("%s/%s bills at the vendor's published rate", (provider, model, rate) => {
    expect(getPricingForModel(provider, model)).toMatchObject(rate);
  });

  it.each(["auto", "qwen4-max", "qwen4-max-preview", "qwen3.8-max", "qwen3.8-flash", "deepseek-v4-pro-0813"])(
    "alitp-intl/%s carries an explicit zero until Token Plan publishes a per-token rate",
    (model) => {
      expect(getPricingForModel("alitp-intl", model)).toMatchObject({ input: 0, output: 0 });
    },
  );

  it("bills unpublished cache reads at the input rate", () => {
    expect(getPricingForModel("deeprelay", "qwen3.8-flash").cached).toBeUndefined();
  });
});
