import { describe, expect, it } from "bun:test";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import tokenplan from "../../open-sse/providers/registry/xiaomi-tokenplan.js";
import { getModelsByProviderId } from "../../src/shared/constants/models.js";

const entry = (id) => REGISTRY.find((e) => e.id === id);
const modelIds = (id) => (PROVIDER_MODELS[id] || []).map((m) => m.id);

describe("registry", () => {
  it("keeps every provider id unique", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each([
    ["venice", "https://api.venice.ai/api/v1/chat/completions"],
    ["alitp-intl", "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions"],
  ])("%s is an OpenAI-compatible apikey provider at its own endpoint", (id, baseUrl) => {
    expect(entry(id).category).toBe("apikey");
    expect(PROVIDERS[id].format).toBe("openai");
    expect(PROVIDERS[id].baseUrl).toBe(baseUrl);
  });
});

describe("Venice AI provider", () => {
  it("registers its aliases, passthrough and model discovery", () => {
    const venice = entry("venice");
    expect(venice.alias).toBe("venice");
    expect(venice.aliases).toContain("vn");
    expect(venice.transport.baseUrl).toBe("https://api.venice.ai/api/v1/chat/completions");
    expect(venice.passthroughModels).toBe(true);
    expect(venice.modelsFetcher).toMatchObject({ url: "https://api.venice.ai/api/v1/models", type: "openai" });
  });

  it("exposes its seed models, including the signature uncensored one", () => {
    expect(modelIds("venice")).toContain("venice-uncensored-1-2");
  });
});

describe("Alibaba Token Plan provider", () => {
  it("does not collide with the other Alibaba key types", () => {
    const hosts = ["alicode", "alicode-intl", "alims-intl", "alitp-intl"].map((id) => new URL(PROVIDERS[id].baseUrl).host);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it("exposes the models the plan serves", () => {
    expect(modelIds("alitp-intl")).toEqual(expect.arrayContaining([
      "qwen3.8-max-preview", "qwen3.7-max", "qwen3.7-plus", "qwen3.6-flash", "glm-5.2", "deepseek-v4-pro",
    ]));
  });
});

describe("xiaomi-tokenplan catalog", () => {
  const ids = tokenplan.models.map((m) => m.id);

  it("advertises the current Token Plan models", () => {
    expect(ids).toEqual(expect.arrayContaining(["mimo-v2.6-pro", "mimo-v2.6-flash", "mimo-v2.5-asr"]));
  });

  it.each(["mimo-v2.5-pro", "mimo-v2.5", "mimo-v2-pro", "mimo-v2-omni", "mimo-v2.5-pro-claude"])(
    "drops %s, retired upstream on 2026-10-21",
    (dead) => {
      expect(ids).not.toContain(dead);
    }
  );

  it("keeps the modality kinds the router dispatches on", () => {
    const byId = new Map(tokenplan.models.map((m) => [m.id, m]));
    expect(byId.get("mimo-v2.5-asr").kind).toBe("stt");
    expect(byId.get("mimo-v2.5-tts").kind).toBe("tts");
    expect(byId.get("mimo-v2.6-pro").kind).toBeUndefined();
  });

  it("is wired into the shared model table", () => {
    expect(getModelsByProviderId("xiaomi-tokenplan").map((m) => m.id)).toContain("mimo-v2.6-pro");
  });
});
