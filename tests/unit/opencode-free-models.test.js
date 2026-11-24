import { describe, expect, it } from "bun:test";

import { isOpencodeFreeModelId, parseOpencodeFreeModels } from "../../open-sse/services/opencodeFreeModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

const NEW_FREE_IDS = [
  "longcat-2.5-free", "iceman-free", "inkling-2-small-free", "beam-free", "flint-40b-free",
  "nemotron-3.5-super-vl-free", "jev-1.13-free", "nemotron-3.5-lightning-free", "hy4-flash-free", "tidepool-alpha-free",
];

describe("OpenCode free catalog", () => {
  it.each([
    ["glm-5.3-flash-free", true],
    ["big-pickle", true],
    ["claude-sonnet-5", false],
    [undefined, false],
  ])("classifies %p as free=%p", (id, free) => {
    expect(isOpencodeFreeModelId(id)).toBe(free);
  });

  it("keeps free ids and their published limits from the live catalog", () => {
    const models = parseOpencodeFreeModels({
      data: [
        { id: "beam-free", name: "Beam", limit: { context: 1048576, output: 131072 }, capabilities: { reasoning: { supported: true }, tools: { supported: true } } },
        { id: "gpt-6-sol" },
        { id: "big-pickle" },
      ],
    });
    expect(models).toEqual([
      { id: "beam-free", name: "Beam", capabilities: { contextWindow: 1048576, maxOutput: 131072, reasoning: true, tools: true } },
      { id: "big-pickle", name: "big-pickle", capabilities: undefined },
    ]);
  });

  it.each(NEW_FREE_IDS)("prices %s at zero and publishes its window", (id) => {
    expect(getPricingForModel("opencode", id)).toMatchObject({ input: 0, output: 0 });
    expect(getCapabilitiesForModel("opencode", id).contextWindow).toBeGreaterThanOrEqual(64000);
  });
});
