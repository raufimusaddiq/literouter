import { describe, expect, it } from "bun:test";
import { assertImageSize } from "../../scripts/check-image-size.mjs";

describe("assertImageSize", () => {
  it("passes at the limit and fails one byte over", () => {
    expect(() => assertImageSize(150_000_000, 150)).not.toThrow();
    expect(() => assertImageSize(150_000_001, 150)).toThrow("image is 150.0 MB, limit 150 MB");
  });

  it("reports MB with one decimal", () => {
    expect(assertImageSize(105_640_000, 150)).toEqual({ mb: 105.6 });
    expect(assertImageSize(999_999, 150)).toEqual({ mb: 1 });
  });

  it("rejects non-numeric size", () => {
    expect(() => assertImageSize("abc", 150)).toThrow();
    expect(() => assertImageSize(Number.NaN, 150)).toThrow();
    expect(() => assertImageSize(-1, 150)).toThrow();
  });

  it("rejects non-decimal size strings", () => {
    for (const bad of ["0x10", "1e3", " 12 ", "1_000", "12.5", "", "-5"]) {
      expect(() => assertImageSize(bad, 150)).toThrow("not a number");
    }
    expect(assertImageSize("105640000", 150)).toEqual({ mb: 105.6 });
  });

  it("rejects a limit that is not a positive finite number", () => {
    for (const bad of [0, -1, Number.NaN, Infinity, "150", undefined, null]) {
      expect(() => assertImageSize(1, bad)).toThrow("limit must be a positive number");
    }
  });
});
