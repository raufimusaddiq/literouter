import { describe, it, expect } from "vitest";
import {
  getCapacityAdapterConfig,
  getCapacityAdapterModels,
  getCapacityAdapterStrategy,
} from "open-sse/services/capacityAdapter.js";

// An enabled pool with no models used to be silently re-seeded with a hardcoded
// fallback the UI could not remove, so users could not disable it.
describe("capacity adapter empty pools", () => {
  const settingsWith = (vision) => ({ capacityAdapter: { vision } });

  it("leaves an enabled but empty pool empty", () => {
    const cfg = getCapacityAdapterConfig("vision", settingsWith({ enabled: true, models: [] }));
    expect(cfg.enabled).toBe(true);
    expect(cfg.models).toEqual([]);
  });

  it("never injects a model the user did not choose", () => {
    const models = getCapacityAdapterModels(settingsWith({ enabled: true, models: [] }));
    expect(models).toEqual([]);
  });

  it("a disabled pool contributes nothing even with models set", () => {
    const settings = settingsWith({ enabled: false, models: ["cx/gpt-6-sol"] });
    expect(getCapacityAdapterModels(settings)).toEqual([]);
    expect(getCapacityAdapterStrategy("vision", settings)).toBe("fallback");
  });

  it("keeps a populated enabled pool intact", () => {
    const settings = settingsWith({ enabled: true, models: ["cx/gpt-6-luna"] });
    expect(getCapacityAdapterModels(settings)).toEqual(["cx/gpt-6-luna"]);
    expect(getCapacityAdapterStrategy("vision", settings)).toBe("fallback");
  });

  it("uses round-robin only when enabled and requested", () => {
    const rr = settingsWith({ enabled: true, roundRobin: true, models: ["cx/gpt-6-luna"] });
    expect(getCapacityAdapterStrategy("vision", rr)).toBe("round-robin");
  });

  it("treats a missing entry as disabled", () => {
    const cfg = getCapacityAdapterConfig("vision", {});
    expect(cfg.enabled).toBe(false);
    expect(cfg.models).toEqual([]);
  });
});
