import { describe, it, expect } from "vitest";
import { percentile, summarize, slope, fmt } from "../../scripts/bench/stats.mjs";

describe("bench stats helper", () => {
  it("percentile of empty sample is NaN", () => {
    expect(percentile([], 50)).toBeNaN();
  });
  it("single value is every percentile", () => {
    expect(percentile([7], 0)).toBe(7);
    expect(percentile([7], 99)).toBe(7);
  });
  it("interpolates linearly and ignores input order", () => {
    const v = [40, 10, 30, 20];
    expect(percentile(v, 0)).toBe(10);
    expect(percentile(v, 50)).toBe(25);
    expect(percentile(v, 100)).toBe(40);
    expect(v).toEqual([40, 10, 30, 20]);
  });
  it("clamps out-of-range p", () => {
    expect(percentile([1, 2, 3], -5)).toBe(1);
    expect(percentile([1, 2, 3], 150)).toBe(3);
  });
  it("p99 of 1..100", () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 99)).toBeCloseTo(99.01, 5);
    expect(percentile(v, 90)).toBeCloseTo(90.1, 5);
  });
  it("summarize drops non-finite and reports fields", () => {
    const s = summarize([1, 2, 3, 4, NaN, Infinity, undefined]);
    expect(s.count).toBe(4);
    expect(s.min).toBe(1);
    expect(s.max).toBe(4);
    expect(s.mean).toBe(2.5);
    expect(s.p50).toBe(2.5);
  });
  it("summarize of nothing is all NaN with count 0", () => {
    const s = summarize([]);
    expect(s.count).toBe(0);
    expect(s.p99).toBeNaN();
  });
  it("slope recovers a linear trend", () => {
    expect(slope([0, 1, 2, 3], [5, 7, 9, 11])).toBeCloseTo(2, 10);
    expect(slope([1], [1])).toBeNaN();
  });
  it("fmt handles NaN", () => {
    expect(fmt(NaN)).toBe("n/a");
    expect(fmt(1.234, 2)).toBe("1.23");
  });
});
