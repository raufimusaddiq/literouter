import { describe, it, expect } from "bun:test";
import { getOutputTokens, getInputTokens, fmtCompactTokens } from "@/web/pages/dashboard/usage/components/tokenDisplay.js";

describe("getOutputTokens — issue #3890", () => {
  it("Claude-format usage {output_tokens: 100} displays 100, not 0", () => {
    expect(getOutputTokens({ input_tokens: 50, output_tokens: 100 })).toBe(100);
  });

  it("OpenAI-format usage {completion_tokens: 100} still displays 100", () => {
    expect(getOutputTokens({ prompt_tokens: 50, completion_tokens: 100 })).toBe(100);
  });

  it("missing/empty tokens → 0, no throw", () => {
    expect(getOutputTokens(undefined)).toBe(0);
    expect(getOutputTokens(null)).toBe(0);
    expect(getOutputTokens({})).toBe(0);
    expect(() => getOutputTokens(undefined).toLocaleString()).not.toThrow();
  });

  it("input helper unchanged: Claude input_tokens fallback still works", () => {
    expect(getInputTokens({ input_tokens: 50 })).toBe(50);
  });
});

describe("fmtCompactTokens - issue #5670", () => {
  it.each([
    [0, "0"], [null, "0"], [undefined, "0"], [842, "842"],
    [1000, "1.0K"], [15_400, "15.4K"], [550_000_000, "550.0M"],
    [1_000_000_000, "1.0B"], [1_100_000_000, "1.1B"], [2_200_000_000, "2.2B"], [1_250_000_000_000, "1.3T"],
    [999_950, "1.0M"], [999_950_000, "1.0B"], [999_950_000_000, "1.0T"],
  ])("formats %p as %p", (n, out) => {
    expect(fmtCompactTokens(n)).toBe(out);
  });
});
