import { describe, expect, it } from "bun:test";

import { getPricingForModel, PROVIDER_PRICING } from "../../open-sse/providers/pricing.js";
import { PROVIDER_CAPABILITIES } from "../../open-sse/providers/capabilities.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

const staticIds = (providerId) =>
  (REGISTRY.find((entry) => entry.id === providerId)?.models || []).map((m) => m.id);

describe.each(["opendesign-go", "deeprelay", "alitp-intl"])("%s model tracking", (provider) => {
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

  it("bills every prepaid Token Plan id at an explicit zero", () => {
    for (const id of staticIds("alitp-intl")) {
      expect(getPricingForModel("alitp-intl", id), id).toMatchObject({ input: 0, output: 0 });
    }
  });

  it("bills unpublished cache reads at the input rate", () => {
    expect(getPricingForModel("deeprelay", "qwen3.8-flash").cached).toBeUndefined();
  });

  it("carries no cache-write rate on DeepRelay, which publishes none", () => {
    for (const [id, rate] of Object.entries(PROVIDER_PRICING.deeprelay)) {
      expect(rate.cache_creation, id).toBeUndefined();
    }
  });

  it.each([
    ["k3.1-pro", { input: 2, output: 10, cached: 0.2 }],
    ["k3.1-pro-highspeed", { input: 0, output: 0 }],
  ])("kimi/%s has an explicit pricing row", (model, rate) => {
    expect(getPricingForModel("kimi", model)).toMatchObject(rate);
  });
});
