import { describe, it, expect } from "bun:test";
import { niceTicks } from "../../src/web/pages/dashboard/overview/niceTicks.js";

describe("niceTicks", () => {
  it("produces round evenly spaced integer ticks for the required cases", () => {
    expect(niceTicks(35)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(790)).toEqual([0, 250, 500, 750, 1000]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(0)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(1000)).toEqual([0, 250, 500, 750, 1000]);
  });

  it("keeps ticks integer, evenly spaced, starting at 0, and at or above max", () => {
    for (const max of [0, 1, 3, 5, 12, 35, 99, 100, 340, 790, 1000, 4200, 99999]) {
      const ticks = niceTicks(max);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
      expect(ticks.length).toBe(5);
      const step = ticks[1] - ticks[0];
      expect(step).toBeGreaterThan(0);
      for (let i = 0; i < ticks.length; i += 1) {
        expect(Number.isInteger(ticks[i])).toBe(true);
        expect(ticks[i]).toBe(i * step);
      }
    }
  });
});
