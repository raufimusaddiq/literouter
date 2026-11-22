import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel, setCatalogSource } from "../../open-sse/providers/capabilities.js";
import { PROVIDER_ALIASES, build } from "../../src/lib/modelCatalog/sync.js";

const API_WINDOW = 1050000;
const LEGACY_GPT5_WINDOW = 400000;

describe("gpt-6 / gpt-5.4+ context windows", () => {
  it("reports the 1.05M API window for gpt-6 models on ordinary providers", () => {
    for (const [provider, model] of [
      ["github", "gpt-6-luna"],
      ["azure", "gpt-6-luna"],
      ["openai", "gpt-6-luna"],
      ["github", "gpt-6-sol"],
      ["openai", "gpt-6-astra"],
    ]) {
      expect(getCapabilitiesForModel(provider, model).contextWindow, `${provider}/${model}`).toBe(API_WINDOW);
    }
  });

  it("leaves the gateways that truncate lower on their own numbers", () => {
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-luna").contextWindow).toBe(272000);
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-luna-thinking-agentic").contextWindow).toBe(272000);
    expect(getCapabilitiesForModel("codex", "gpt-5.6-luna").contextWindow).toBe(272000);
    expect(getCapabilitiesForModel("codex", "gpt-5.6-sol").contextWindow).toBe(372000);
    expect(getCapabilitiesForModel("codex", "gpt-6-astra").contextWindow).toBe(272000);
  });

  it("keeps Devin CLI's seven GPT-5.4/5.5 variants at the gateway's 200k limit", () => {
    for (const model of [
      "gpt-5.4-high", "gpt-5.4-medium", "gpt-5.4-low",
      "gpt-5.5-xhigh", "gpt-5.5-high", "gpt-5.5-medium", "gpt-5.5-low",
    ]) {
      expect(getCapabilitiesForModel("devin-cli", model), model).toMatchObject({
        contextWindow: 200000,
        maxOutput: 128000,
        vision: true,
        reasoning: true,
        thinkingFormat: "openai",
      });
    }
    expect(getCapabilitiesForModel("dv", "gpt-5.5-high").contextWindow).toBe(200000);
    expect(getCapabilitiesForModel("devin", "gpt-5.5-high").contextWindow).toBe(200000);
  });

  it("splits the 1.05M tiers from the 400k ones", () => {
    for (const model of [
      "gpt-5.4", "gpt-5.4-pro", "gpt-5.5", "gpt-5.5-pro", "gpt-5.6", "gpt-5.6-luna", "gpt-5.6-terra",
    ]) {
      expect(getCapabilitiesForModel("openai", model).contextWindow, model).toBe(API_WINDOW);
    }
    for (const model of ["gpt-5.4-mini", "gpt-5.4-nano", "gpt-5", "gpt-5.1", "gpt-5.2", "gpt-5.3-codex"]) {
      expect(getCapabilitiesForModel("openai", model).contextWindow, model).toBe(LEGACY_GPT5_WINDOW);
    }
  });
});

describe("models.dev sync reaches GitHub Copilot", () => {
  it("maps the local github id onto the upstream github-copilot id", () => {
    expect(PROVIDER_ALIASES.github).toBe("github-copilot");
  });

  it("records a Copilot limit that disagrees with the local tables", () => {
    const upstream = {
      "github-copilot": {
        models: { "claude-sonnet-4.6": { limit: { context: 200000, output: 32000 } } },
      },
    };
    const entries = [
      { provider: "github", model: "claude-sonnet-4.6", current: { contextWindow: 200000, maxOutput: 64000 } },
    ];

    expect(build(upstream, entries).providers.github).toEqual({
      "claude-sonnet-4.6": { maxOutput: 32000 },
    });
  });

  it("applies those Copilot deltas to an exact MODEL_CAPABILITIES id", () => {
    setCatalogSource({
      getModalities: () => null,
      getLimits: (provider, model) =>
        provider === "github" && model === "claude-sonnet-4.6" ? { maxOutput: 32000 } : null,
    });
    try {
      expect(getCapabilitiesForModel("github", "claude-sonnet-4.6").maxOutput).toBe(32000);
      expect(getCapabilitiesForModel("claude", "claude-sonnet-4.6").maxOutput).toBe(128000);
    } finally {
      setCatalogSource(null);
    }
  });
});
