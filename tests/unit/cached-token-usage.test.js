import { describe, it, expect } from "bun:test";
import { canonicalizeUsage, extractUsage, mergeUsage } from "../../open-sse/utils/usageTracking.js";
import { calculateCostFromTokens } from "../../open-sse/providers/pricing.js";
import { buildUsage, toOpenAIUsage } from "../../open-sse/translator/concerns/usage.js";

describe("canonicalizeUsage", () => {
  it("folds Claude exclusive cache into an inclusive prompt count", () => {
    const out = canonicalizeUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 30,
    });
    expect(out.prompt_tokens).toBe(330);
    expect(out.completion_tokens).toBe(50);
    expect(out.cached_tokens).toBe(200);
    expect(out.cache_creation_input_tokens).toBe(30);
  });

  it("passes through OpenAI inclusive prompt unchanged", () => {
    const out = canonicalizeUsage({
      prompt_tokens: 330,
      completion_tokens: 50,
      cached_tokens: 200,
    });
    expect(out.prompt_tokens).toBe(330);
    expect(out.cached_tokens).toBe(200);
    expect(out.cache_creation_input_tokens).toBe(0);
  });

  it("passes through Gemini inclusive prompt (cachedContent already counted)", () => {
    const out = canonicalizeUsage({
      prompt_tokens: 500,
      completion_tokens: 80,
      cached_tokens: 120,
      reasoning_tokens: 40,
    });
    expect(out.prompt_tokens).toBe(500);
    expect(out.cached_tokens).toBe(120);
    expect(out.reasoning_tokens).toBe(40);
  });

  it("reads cached_tokens from the nested buildUsage() shape", () => {
    const out = canonicalizeUsage(
      buildUsage({ promptTokens: 330, completionTokens: 50, totalTokens: 380, cachedTokens: 200 })
    );
    expect(out.prompt_tokens).toBe(330);
    expect(out.cached_tokens).toBe(200);
  });

  it("handles no-cache usage", () => {
    const out = canonicalizeUsage({ prompt_tokens: 100, completion_tokens: 50 });
    expect(out.prompt_tokens).toBe(100);
    expect(out.cached_tokens).toBe(0);
    expect(out.cache_creation_input_tokens).toBe(0);
  });

  it("is idempotent (running twice yields the same canonical shape)", () => {
    const once = canonicalizeUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 30,
    });
    const twice = canonicalizeUsage(once);
    expect(twice.prompt_tokens).toBe(330);
    expect(twice.cached_tokens).toBe(200);
    expect(twice.cache_creation_input_tokens).toBe(30);
    expect(twice.completion_tokens).toBe(50);
  });

  it("returns null for invalid input", () => {
    expect(canonicalizeUsage(null)).toBeNull();
    expect(canonicalizeUsage(undefined)).toBeNull();
  });

  it("folds a Claude cache-miss first write (cache_creation only, no cache_read yet)", () => {
    const out = canonicalizeUsage({
      prompt_tokens: 100,
      completion_tokens: 20,
      cache_creation_input_tokens: 500,
    });
    expect(out.prompt_tokens).toBe(600);
    expect(out.cached_tokens).toBe(0);
    expect(out.cache_creation_input_tokens).toBe(500);
  });
});

describe("calculateCostFromTokens (canonical inclusive convention)", () => {
  const pricing = { input: 3, output: 15, cached: 0.3, cache_creation: 3.75 };

  it("prices cached + cache_creation as subsets of an inclusive prompt without double-counting", () => {
    const cost = calculateCostFromTokens(
      { prompt_tokens: 330, completion_tokens: 50, cached_tokens: 200, cache_creation_input_tokens: 30 },
      pricing
    );
    const expected =
      (100 * 3 + 200 * 0.3 + 30 * 3.75 + 50 * 15) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 12);
  });

  it("does not let cache_creation drive nonCached negative", () => {
    const cost = calculateCostFromTokens(
      { prompt_tokens: 100, completion_tokens: 0, cached_tokens: 80, cache_creation_input_tokens: 40 },
      pricing
    );
    const expected = (0 * 3 + 80 * 0.3 + 40 * 3.75) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 12);
  });

  it("matches plain input pricing when no cache present", () => {
    const cost = calculateCostFromTokens({ prompt_tokens: 100, completion_tokens: 50 }, pricing);
    expect(cost).toBeCloseTo((100 * 3 + 50 * 15) / 1_000_000, 12);
  });
});

describe("Anthropic streaming usage (message_start carries cache, message_delta output-only)", () => {
  it("extractUsage reads input + cache from message_start", () => {
    const u = extractUsage({
      type: "message_start",
      message: { usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 200, cache_creation_input_tokens: 30 } },
    });
    expect(u.prompt_tokens).toBe(100);
    expect(u.cache_read_input_tokens).toBe(200);
    expect(u.cache_creation_input_tokens).toBe(30);
  });

  it("merges message_start cache with message_delta output without clobbering", () => {
    const start = extractUsage({
      type: "message_start",
      message: { usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 200, cache_creation_input_tokens: 30 } },
    });
    const delta = extractUsage({ type: "message_delta", usage: { output_tokens: 50 } });
    const merged = mergeUsage(start, delta);
    expect(merged.prompt_tokens).toBe(100);
    expect(merged.cache_read_input_tokens).toBe(200);
    expect(merged.cache_creation_input_tokens).toBe(30);
    expect(merged.completion_tokens).toBe(50);

    const canon = canonicalizeUsage(merged);
    expect(canon.prompt_tokens).toBe(330);
    expect(canon.cached_tokens).toBe(200);
    expect(canon.cache_creation_input_tokens).toBe(30);
    expect(canon.completion_tokens).toBe(50);
  });

  it("takes the delta's non-cached input when only message_delta carries cache fields", () => {
    const start = extractUsage({ type: "message_start", message: { usage: { input_tokens: 1000, output_tokens: 1 } } });
    const delta = extractUsage({
      type: "message_delta",
      usage: { input_tokens: 200, output_tokens: 50, cache_read_input_tokens: 800 },
    });
    const canon = canonicalizeUsage(mergeUsage(start, delta));
    expect(canon.prompt_tokens).toBe(1000);
    expect(canon.cached_tokens).toBe(800);
  });

  it("does not let a NaN field poison the running max-merge", () => {
    const prev = { prompt_tokens: 100, cache_read_input_tokens: 200 };
    const bad = { prompt_tokens: NaN, completion_tokens: 50 };
    const merged = mergeUsage(prev, bad);
    expect(merged.prompt_tokens).toBe(100);
    expect(merged.cache_read_input_tokens).toBe(200);
    expect(merged.completion_tokens).toBe(50);
  });
});

describe("Kiro usage pass-through", () => {
  it("passes through plain input/output when no cache fields are present", () => {
    const out = toOpenAIUsage({ inputTokens: 100, outputTokens: 50 }, "kiro");
    expect(out.prompt_tokens).toBe(100);
    expect(out.completion_tokens).toBe(50);
    expect(out.total_tokens).toBe(150);
    expect(out.prompt_tokens_details).toBeUndefined();
  });

  it("forward-compat: surfaces cache fields if Kiro event shape grows them", () => {
    const out = toOpenAIUsage(
      { inputTokens: 500, outputTokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 50 },
      "kiro"
    );
    expect(out.prompt_tokens_details).toBeDefined();
    expect(out.prompt_tokens_details.cached_tokens).toBe(200);
    expect(out.prompt_tokens_details.cache_creation_tokens).toBe(50);
  });
});
