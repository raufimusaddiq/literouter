import { afterEach, describe, expect, it, vi } from "vitest";

import { drainRuntimeBuffersSync } from "@/lib/db/shutdown.js";

afterEach(() => {
  delete globalThis.__liteRouterUsageDrainSync;
  delete globalThis.__liteRouterDrainSync;
});

describe("DB shutdown runtime drain", () => {
  it("drains Usage and request-detail buffers before adapter close", () => {
    const usage = vi.fn();
    const details = vi.fn();
    globalThis.__liteRouterUsageDrainSync = usage;
    globalThis.__liteRouterDrainSync = details;

    expect(drainRuntimeBuffersSync()).toBe(true);
    expect(usage).toHaveBeenCalledTimes(1);
    expect(details).toHaveBeenCalledTimes(1);
  });

  it("continues draining remaining buffers if one drain fails", () => {
    globalThis.__liteRouterUsageDrainSync = vi.fn(() => {
      throw new Error("usage flush failed");
    });
    const details = vi.fn();
    globalThis.__liteRouterDrainSync = details;

    expect(drainRuntimeBuffersSync()).toBe(false);
    expect(details).toHaveBeenCalledTimes(1);
  });
});
