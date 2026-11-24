import { describe, expect, it } from "bun:test";

import { getPricingForModel, PRICING_STAND_INS, PROVIDER_PRICING } from "../../open-sse/providers/pricing.js";
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

  it("bills every prepaid Token Plan id at a cited family list-price stand-in", () => {
    for (const id of staticIds("alitp-intl")) {
      const standIn = PRICING_STAND_INS["alitp-intl"][id];
      expect(standIn?.source, id).toBeTruthy();
      expect(getPricingForModel("alitp-intl", id).input, id).toBeGreaterThan(0);
    }
  });

  it.each([
    ["auto", { input: 1.5, output: 4.5 }],
    ["qwen4-max-preview", { input: 1.5, output: 4.5 }],
    ["qwen3.8-max-preview", { input: 2, output: 6 }],
    ["qwen3.8-flash", { input: 0.15, output: 0.47 }],
    ["qwen3.7-max", { input: 2.5, output: 7.5 }],
    ["qwen3.7-plus", { input: 0.4, output: 1.6 }],
    ["qwen3.6-flash", { input: 0.25, output: 1.5 }],
    ["glm-5.2", { input: 1.4, output: 4.4, cached: 0.26 }],
    ["deepseek-v4-pro-0813", { input: 1.32, output: 3.96, cached: 0.044 }],
    ["deepseek-v4.1-flash-1017", { input: 0.3, output: 1.2, cached: 0.006 }],
  ])("alitp-intl/%s bills at its family list price", (model, rate) => {
    expect(getPricingForModel("alitp-intl", model)).toMatchObject(rate);
  });

  it("bills unpublished cache reads at the input rate", () => {
    expect(getPricingForModel("deeprelay", "qwen3.8-flash").cached).toBeUndefined();
  });

  it("carries no cache-write rate on DeepRelay, which publishes none", () => {
    for (const [id, rate] of Object.entries(PROVIDER_PRICING.deeprelay)) {
      expect(rate.cache_creation, id).toBeUndefined();
    }
  });

  it.each(["k3.1-pro", "k3.1-pro-highspeed"])("kimi/%s bills at the K3.1 Pro rate", (model) => {
    expect(getPricingForModel("kimi", model)).toMatchObject({ input: 2, output: 10, cached: 0.2 });
  });
});
