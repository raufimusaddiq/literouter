import { describe, expect, it } from "bun:test";
import { mergeWithDefaults } from "../../src/lib/db/repos/settingsRepo.js";

describe("mergeWithDefaults", () => {
  it("preserves sibling capacityAdapter modalities when partial config is stored", () => {
    const merged = mergeWithDefaults({
      capacityAdapter: {
        vision: { enabled: true, roundRobin: true, models: ["openai/gpt-4o"] },
      },
    });

    expect(merged.capacityAdapter.vision).toEqual({
      enabled: true,
      roundRobin: true,
      models: ["openai/gpt-4o"],
    });
    expect(merged.capacityAdapter.pdf).toEqual({ enabled: false, roundRobin: false, models: [] });
    expect(merged.capacityAdapter.audioInput).toEqual({ enabled: false, roundRobin: false, models: [] });
    expect(merged.capacityAdapter.videoInput).toEqual({ enabled: false, roundRobin: false, models: [] });
  });

  it("returns isolated object defaults without mutating shared defaults across calls", () => {
    const first = mergeWithDefaults({});
    first.capacityAdapter.pdf.models.push("google/gemini-2.5-flash");
    first.providerStrategies.openai = { fallbackStrategy: "round-robin" };

    const second = mergeWithDefaults({});
    expect(second.capacityAdapter.pdf.models).toEqual([]);
    expect(second.providerStrategies).toEqual({});
  });

  it("preserves and clones unknown capacityAdapter modalities alongside defaults", () => {
    const custom = { enabled: true, roundRobin: false, models: ["anthropic/claude-3-7-sonnet"] };
    const merged = mergeWithDefaults({
      capacityAdapter: {
        customModality: custom,
      },
    });

    expect(merged.capacityAdapter.customModality).toEqual(custom);
    expect(merged.capacityAdapter.customModality).not.toBe(custom);
    expect(merged.capacityAdapter.vision).toEqual({ enabled: false, roundRobin: false, models: [] });
  });
});
