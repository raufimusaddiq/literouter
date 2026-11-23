import { describe, it, expect } from "bun:test";
import { niceTicks } from "../../src/web/pages/dashboard/overview/niceTicks.js";

function isAllowedIntegerStep(step) {
  if (!Number.isInteger(step) || step < 1) return false;
  let scaled = step;
  while (scaled >= 10 && scaled % 10 === 0) {
    scaled /= 10;
  }
  return scaled === 1 || scaled === 2 || scaled === 5 || scaled === 25;
}

describe("niceTicks", () => {
  it.each([
    [35, [0, 10, 20, 30, 40]],
    [790, [0, 200, 400, 600, 800]],
    [3, [0, 1, 2, 3, 4]],
    [0, [0, 1, 2, 3, 4]],
    [8, [0, 2, 4, 6, 8]],
    [9, [0, 5, 10, 15, 20]],
    [10, [0, 5, 10, 15, 20]],
    [1000, [0, 250, 500, 750, 1000]],
    [41, [0, 20, 40, 60, 80]],
    [4500, [0, 2000, 4000, 6000, 8000]],
  ])("produces round evenly spaced integer ticks for max=%d", (max, expected) => {
    expect(niceTicks(max)).toEqual(expected);
  });

  it("keeps integer steps in {1, 2, 5}*10^n or 2.5*10^n (n>=1) and bounds top against max", () => {
    const cases = [
      ...Array.from({ length: 197 }, (_, i) => i + 4),
      201,
      340,
      790,
      1000,
      1001,
      2001,
      4200,
      4500,
      12345,
      99999,
      1000001,
    ];
    for (const max of cases) {
      const ticks = niceTicks(max);
      const top = ticks[ticks.length - 1];
      expect(ticks[0]).toBe(0);
      expect(ticks.length).toBe(5);
      expect(top).toBeGreaterThanOrEqual(max);
      expect(top).toBeLessThanOrEqual(2.25 * max);
      const step = ticks[1] - ticks[0];
      expect(isAllowedIntegerStep(step)).toBe(true);
      for (let i = 0; i < ticks.length; i += 1) {
        expect(Number.isInteger(ticks[i])).toBe(true);
        expect(ticks[i]).toBe(i * step);
      }
    }
  });

  it.each([
    [0.035, [0, 0.01, 0.02, 0.03, 0.04]],
    [0.45, [0, 0.2, 0.4, 0.6, 0.8]],
    [1.5, [0, 0.5, 1, 1.5, 2]],
    [9, [0, 2.5, 5, 7.5, 10]],
  ])("keeps 2.5 steps and fractional precision when integer=false for max=%s", (max, expected) => {
    expect(niceTicks(max, 4, { integer: false })).toEqual(expected);
  });
});
