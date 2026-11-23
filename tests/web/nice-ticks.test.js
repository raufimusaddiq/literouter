import { describe, it, expect } from "bun:test";
import { niceTicks } from "../../src/web/pages/dashboard/overview/niceTicks.js";

describe("niceTicks", () => {
  it.each([
    [35, [0, 10, 20, 30, 40]],
    [790, [0, 200, 400, 600, 800]],
    [3, [0, 1, 2, 3, 4]],
    [0, [0, 1, 2, 3, 4]],
    [1000, [0, 250, 500, 750, 1000]],
    [41, [0, 20, 40, 60, 80]],
    [4500, [0, 2000, 4000, 6000, 8000]],
  ])("produces round evenly spaced integer ticks for max=%d", (max, expected) => {
    expect(niceTicks(max)).toEqual(expected);
  });

  it("keeps top >= max and top <= 2.2 * max for every max >= 4", () => {
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
      expect(top).toBeLessThanOrEqual(2.2 * max);
      const step = ticks[1] - ticks[0];
      expect(step).toBeGreaterThan(0);
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
  ])("supports fractional cost ticks for max=%s", (max, expected) => {
    expect(niceTicks(max, 4, { integer: false })).toEqual(expected);
  });
});
