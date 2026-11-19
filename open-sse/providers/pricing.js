// Pricing rates for AI models — all rates in $/1M tokens
//
// Fallback order (first match wins):
//   1. PROVIDER_PRICING[provider][model]  — provider-specific override
//   2. MODEL_PRICING[model]               — canonical model price (provider-agnostic)
//   3. PATTERN_PRICING                    — glob pattern match (e.g. "codex-*")

/**
 * Canonical model pricing — provider-agnostic.
 * Cover all known models; deduplicated across providers.
 */
export const MODEL_PRICING = {
  // === Anthropic / Claude ===
  "claude-opus-4-6":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  },
  "claude-opus-4-5-20251101":     { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  },
  "claude-sonnet-4-6":            { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  },
  "claude-sonnet-4-5-20250929":   { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  },
  "claude-haiku-4-5-20251001":    { input: 1.00,  output: 5.00,  cached: 0.10,  reasoning: 5.00,   cache_creation: 1.25  },
  "claude-sonnet-4-20250514":     { input: 3.00,  output: 15.00, cached: 1.50,  reasoning: 15.00,  cache_creation: 3.00  },
  "claude-opus-4-20250514":       { input: 15.00, output: 25.00, cached: 7.50,  reasoning: 112.50, cache_creation: 15.00 },
  "claude-3-5-sonnet-20241022":   { input: 3.00,  output: 15.00, cached: 1.50,  reasoning: 15.00,  cache_creation: 3.00  },
  "claude-haiku-4.5":             { input: 0.50,  output: 2.50,  cached: 0.05,  reasoning: 3.75,   cache_creation: 0.50  },
  "claude-opus-4.1":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-opus-4.5":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-opus-4.6":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-sonnet-4":              { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  "claude-sonnet-4.5":            { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  "claude-sonnet-4.6":            { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  "claude-opus-4-5-thinking":     { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-opus-4-6-thinking":     { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-fable-5-2":             { input: 8.00,  output: 40.00, cached: 0.20,  reasoning: 40.00,  cache_creation: 10.00 },
  // Source: https://platform.claude.com/docs/en/about-claude/pricing (API list,
  // read 2026-11-20). These three differ from their family pattern, so they need
  // exact rows the live OAuth catalog can surface the moment Anthropic ships them.
  "claude-sonnet-5-5":            { input: 2.00,  output: 10.00, cached: 0.10,  reasoning: 10.00,  cache_creation: 2.50  },
  "claude-sonnet-5":              { input: 2.00,  output: 10.00, cached: 0.20,  reasoning: 10.00,  cache_creation: 2.50  },
  "claude-opus-5-5":              { input: 4.00,  output: 20.00, cached: 0.20,  reasoning: 20.00,  cache_creation: 5.00  },
  "claude-fable-5-1":             { input: 10.00, output: 50.00, cached: 1.00,  reasoning: 50.00,  cache_creation: 12.50 },
  "claude-fable-5":               { input: 10.00, output: 50.00, cached: 1.00,  reasoning: 50.00,  cache_creation: 12.50 },
  "claude-haiku-5-5":             { input: 0.10,  output: 0.50,  cached: 0.01,  reasoning: 0.50,   cache_creation: 0.125 },

  // === OpenAI / GPT ===
  // Source: https://developers.openai.com/api/docs/pricing (standard tier, read 2026-11-20); kilocode openai/o3 matches https://ai-gateway.kilo.ai/api/v1/models
  "o3":                           { input: 2.00,  output: 8.00,  cached: 0.50,  reasoning: 8.00,   cache_creation: 0     },
  "gpt-3.5-turbo":                { input: 0.50,  output: 1.50,  cached: 0.25,  reasoning: 2.25,   cache_creation: 0.50  },
  "gpt-4":                        { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  },
  "gpt-4-turbo":                  { input: 10.00, output: 30.00, cached: 5.00,  reasoning: 45.00,  cache_creation: 10.00 },
  "gpt-4o":                       { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  },
  "gpt-4o-mini":                  { input: 0.15,  output: 0.60,  cached: 0.075, reasoning: 0.90,   cache_creation: 0.15  },
  "gpt-4.1":                      { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  },
  "gpt-5":                        { input: 1.25,  output: 10.00, cached: 0.125, reasoning: 10.00,  cache_creation: 1.25  },
  "gpt-5-mini":                   { input: 0.25,  output: 2.00,  cached: 0.025, reasoning: 2.00,   cache_creation: 0.25  },
  "gpt-5-codex":                  { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  },
  "gpt-5.1":                      { input: 1.25,  output: 10.00, cached: 0.125, reasoning: 10.00,  cache_creation: 1.25  },
  "gpt-5.1-codex":                { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  },
  "gpt-5.1-codex-mini":           { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
  "gpt-5.1-codex-mini-high":      { input: 2.00,  output: 8.00,  cached: 1.00,  reasoning: 12.00,  cache_creation: 2.00  },
  "gpt-5.1-codex-max":            { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  },
  "gpt-5.2":                      { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  },
  "gpt-5.2-codex":                { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  },
  "gpt-5.3-codex":                { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  },
  "gpt-5.3-codex-spark":         { input: 3.00,  output: 12.00, cached: 0.30,  reasoning: 12.00,  cache_creation: 3.00  },
  // OpenAI Standard tier, short context (<=272K input), read 2026-11-20:
  // https://developers.openai.com/api/docs/pricing (+ /models/gpt-6.2-astra, /models/gpt-6.2-sol).
  // cache_creation = the 30-minute cache-write rate. Requests over 272K input bill higher
  // (input/cache x2, output x1.5); that tier is not modelled here. Codex bills against
  // subscription quota windows, so these are estimates there.
  // Old->new (2026-11-20): gpt-6-astra 5/25/0.50 -> 10/50/1.00; gpt-6-sol 1/5/0.10 -> 2/10/0.20;
  // gpt-6-luna 0.05/0.25 -> 0.10/0.50/0.01; gpt-5.6-sol 2/10/0.20 -> 4/20/0.40;
  // gpt-5.6-terra 1/6/0.10 -> 2/12/0.20; gpt-5.6-luna 0.10/0.60 -> 0.20/1.20/0.02.
  // TODO(source): the pricing page says a GPT-5.6 Sol promotional price runs until 2026-11-30;
  // the page does not say whether the Standard row above it is list or promo.
  "gpt-5.6":                      { input: 1.00,  output: 6.00,  cached: 0.10,  reasoning: 6.00,   cache_creation: 1.25  }, // TODO(source): not on the 2026-11-20 pricing page; unchanged
  "gpt-5.6-luna":                 { input: 0.20,  output: 1.20,  cached: 0.02,  reasoning: 1.20,   cache_creation: 0.25  },
  "gpt-5.6-terra":                { input: 2.00,  output: 12.00, cached: 0.20,  reasoning: 12.00,  cache_creation: 2.50  },
  "gpt-5.6-sol":                  { input: 4.00,  output: 20.00, cached: 0.40,  reasoning: 20.00,  cache_creation: 5.00  },
  "gpt-6.2-astra":                { input: 8.00,  output: 40.00, cached: 0.40,  reasoning: 40.00,  cache_creation: 10.00 },
  "gpt-6.2-sol":                  { input: 2.00,  output: 10.00, cached: 0.10,  reasoning: 10.00,  cache_creation: 2.50  },
  "gpt-6.1-sol":                  { input: 2.00,  output: 10.00, cached: 0.10,  reasoning: 10.00,  cache_creation: 2.50  },
  "gpt-6.1-terra":                { input: 1.00,  output: 5.00,  cached: 0.05,  reasoning: 5.00,   cache_creation: 1.25  },
  "gpt-6-astra":                  { input: 10.00, output: 50.00, cached: 1.00,  reasoning: 50.00,  cache_creation: 12.50 },
  "gpt-6-sol":                    { input: 2.00,  output: 10.00, cached: 0.20,  reasoning: 10.00,  cache_creation: 2.50  },
  "gpt-6-luna":                   { input: 0.10,  output: 0.50,  cached: 0.01,  reasoning: 0.50,   cache_creation: 0.125 },
  // Same page; the page gives no cache-write rate for these rows -> 0 until published.
  "gpt-5.5":                      { input: 5.00,  output: 30.00, cached: 0.50,  reasoning: 30.00,  cache_creation: 0 }, // TODO(source): cache write unpublished
  "gpt-5.5-pro":                  { input: 30.00, output: 180.00, cached: 0,    reasoning: 180.00, cache_creation: 0 }, // TODO(source): cache rates unpublished
  "gpt-5.4":                      { input: 2.50,  output: 15.00, cached: 0.25,  reasoning: 15.00,  cache_creation: 0 }, // TODO(source): cache write unpublished
  "gpt-5.4-pro":                  { input: 30.00, output: 180.00, cached: 0,    reasoning: 180.00, cache_creation: 0 }, // TODO(source): cache rates unpublished
  "gpt-5.4-mini":                 { input: 0.75,  output: 4.50,  cached: 0.075, reasoning: 4.50,   cache_creation: 0 }, // TODO(source): cache write unpublished
  "gpt-5.4-nano":                 { input: 0.20,  output: 1.25,  cached: 0.02,  reasoning: 1.25,   cache_creation: 0 }, // TODO(source): cache write unpublished
  "gpt-5.2-pro":                  { input: 21.00, output: 168.00, cached: 0,    reasoning: 168.00, cache_creation: 0 }, // TODO(source): cache rates unpublished
  "o1":                           { input: 15.00, output: 60.00, cached: 7.50,  reasoning: 90.00,  cache_creation: 15.00 },
  "o1-mini":                      { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  },

  // === Gemini ===
  // Gemini 4, Standard tier, read 2026-11-20: https://ai.google.dev/gemini-api/docs/pricing
  // (served from aistudio.google.com/docs/pricing). carbon/argon are on an introductory
  // price through 2026-11-30 (input 2 / output 10 / cached 0.10), then 4 / 20 / 0.20 from
  // 2026-12-01. neon and hydrogen show no intro price. cache_creation 0: the page states
  // only an hourly cache-storage fee, not a per-token write rate.
  // TODO(2026-12-01): bump gemini-4-carbon and gemini-4-argon to 4.00 / 20.00 / 0.20.
  "gemini-4-carbon":               { input: 2.00,  output: 10.00, cached: 0.10,  reasoning: 10.00,  cache_creation: 0 },
  "gemini-4-argon":                { input: 2.00,  output: 10.00, cached: 0.10,  reasoning: 10.00,  cache_creation: 0 },
  "gemini-4-neon":                 { input: 3.00,  output: 15.00, cached: 0.15,  reasoning: 15.00,  cache_creation: 0 },
  "gemini-4-hydrogen":             { input: 1.50,  output: 7.50,  cached: 0.075, reasoning: 7.50,   cache_creation: 0 },
  // gemini-3.8-flash / 3.6-flash below stay at the post-intro list rate (the page shows
  // 0.75 / 3.75 / 0.075 through 2026-12-31, then 1.50 / 7.50 / 0.15).
  "gemini-3.8-flash":              { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.8-flash-high":         { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.8-flash-medium":       { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.8-flash-low":          { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.7-flash":              { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.7-flash-high":         { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.7-flash-medium":       { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.7-flash-low":          { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.6-flash":              { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.6-flash-high":         { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.6-flash-medium":       { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.6-flash-low":          { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.5-flash-lite":         { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.375 },
  "gemini-3.5-flash-high":         { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-3-flash-preview":        { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-3-pro-preview":         { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  },
  "gemini-3.1-pro-low":           { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  },
  "gemini-3.1-pro-high":          { input: 4.00,  output: 18.00, cached: 0.50,  reasoning: 27.00,  cache_creation: 4.00  },
  "gemini-pro-agent":             { input: 4.00,  output: 18.00, cached: 0.50,  reasoning: 27.00,  cache_creation: 4.00  },
  "gemini-3-flash-agent":         { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-3.5-flash-low":         { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-3.5-flash-extra-low":   { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-3-flash":               { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-2.5-pro":               { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  },
  "gemini-2.5-flash":             { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.30  },
  "gemini-2.5-flash-lite":        { input: 0.15,  output: 1.25,  cached: 0.015, reasoning: 1.875,  cache_creation: 0.15  },

  // === Tencent Hy4 ===
  // https://www.tencentcloud.com/document/product/1300/78937 (TokenHub model pricing,
  // last updated 2026-11-19), USD per 1M tokens. The page's region tab for these columns
  // is not stated. Limited-time 50% discounts (hy4-flash to 2026-11-30, hy4 to 2026-12-31)
  // are not applied. Cache write is blank on the page -> 0.
  "hy4":                          { input: 0.834, output: 2.501, cached: 0.042, reasoning: 2.501,  cache_creation: 0 }, // TODO(source): cache write unpublished
  "hy4-flash":                    { input: 0.07,  output: 0.281, cached: 0.003, reasoning: 0.281,  cache_creation: 0 }, // TODO(source): cache write unpublished
  "hy4-preview":                  { input: 0.834, output: 2.501, cached: 0.042, reasoning: 2.501,  cache_creation: 0 }, // same page; marked "To Be Discontinued"

  // === Qwen ===
  "qwen3-coder-plus":             { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  "qwen3-coder-flash":            { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },

  // === Kimi ===
  // Official platform.kimi.ai: cache-hit / cache-miss / output per 1M tokens
  "kimi-k3":                      { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.00  },
  "k3":                           { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.00  },
  "kimi-k2.7-code":               { input: 0.95,  output: 4.00,  cached: 0.19,  reasoning: 4.00,   cache_creation: 0.95  },
  "kimi-k2.7-code-highspeed":     { input: 1.90,  output: 8.00,  cached: 0.38,  reasoning: 8.00,   cache_creation: 1.90  },
  "kimi-for-coding":              { input: 0.95,  output: 4.00,  cached: 0.19,  reasoning: 4.00,   cache_creation: 0.95  },
  "kimi-for-coding-highspeed":    { input: 1.90,  output: 8.00,  cached: 0.38,  reasoning: 8.00,   cache_creation: 1.90  },
  "kimi-k2":                      { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  "kimi-k2-thinking":             { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
  "kimi-k2.5":                    { input: 1.20,  output: 4.80,  cached: 0.60,  reasoning: 7.20,   cache_creation: 1.20  },
  "kimi-k2.5-thinking":           { input: 1.80,  output: 7.20,  cached: 0.90,  reasoning: 10.80,  cache_creation: 1.80  },
  "kimi-k2.6":                    { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  "kimi-latest":                  { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },

  // === DeepSeek ===
  "deepseek-chat":                { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-reasoner":            { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-r1":                  { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-v3.2-chat":           { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-v3.2-reasoner":       { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  // https://api-docs.deepseek.com/quick_start/pricing (read 2026-11-20), off-peak rate.
  // Peak (01-04 and 06-10 UTC Mon-Fri) is 2x: flash 0.006/0.30/1.20, v4-pro 0.044/1.32/3.96.
  // Old->new: deepseek-flash 0.14/0.28/0.0028 -> 0.15/0.60/0.003; deepseek-v4-pro 0.435/0.87/0.003625 -> 0.66/1.98/0.022.
  // The page says deepseek-v4-flash is served by V4.1-Flash at the Flash price.
  "deepseek-v4-flash":            { input: 0.15,  output: 0.60,  cached: 0.003,  reasoning: 0.60,   cache_creation: 0.15  },
  "deepseek-v4.1-flash":          { input: 0.15,  output: 0.60,  cached: 0.003,  reasoning: 0.60,   cache_creation: 0.15  },
  "deepseek-flash":               { input: 0.15,  output: 0.60,  cached: 0.003,  reasoning: 0.60,   cache_creation: 0.15  },
  "deepseek-v4-pro":              { input: 0.66,  output: 1.98,  cached: 0.022,  reasoning: 1.98,   cache_creation: 0.66  },

  // === GLM ===
  "glm-4.6":                      { input: 0.60,  output: 2.20,  cached: 0.11,  reasoning: 2.20,   cache_creation: 0 },
  "glm-4.6v":                     { input: 0.30,  output: 0.90,  cached: 0.05,  reasoning: 0.90,   cache_creation: 0 },
  "glm-4.7":                      { input: 0.60,  output: 2.20,  cached: 0.11,  reasoning: 2.20,   cache_creation: 0 },
  // https://docs.z.ai/guides/overview/pricing (read 2026-11-20); cached input storage is
  // "limited-time free" so cache_creation is 0. Old->new: glm-5 1/4/0.50 -> 1/3.2/0.2;
  // glm-4.7 0.75/3/0.375 -> 0.6/2.2/0.11; glm-4.6 0.5/2/0.25 -> 0.6/2.2/0.11;
  // glm-4.6v 0.75/3/0.375 -> 0.3/0.9/0.05.
  "glm-5.3":                      { input: 1.40,  output: 4.40,  cached: 0.26,  reasoning: 4.40,   cache_creation: 0 },
  "glm-5.3-flash":                { input: 0.15,  output: 0.50,  cached: 0.03,  reasoning: 0.50,   cache_creation: 0 },
  "glm-5.2":                      { input: 1.40,  output: 4.40,  cached: 0.26,  reasoning: 4.40,   cache_creation: 0 },
  "glm-5.1":                      { input: 1.40,  output: 4.40,  cached: 0.26,  reasoning: 4.40,   cache_creation: 0 },
  "glm-5":                        { input: 1.00,  output: 3.20,  cached: 0.20,  reasoning: 3.20,   cache_creation: 0 },

  // === MiniMax ===
  "MiniMax-M3":                   { input: 0.30,  output: 1.20,  cached: 0.06,  reasoning: 1.80,   cache_creation: 0.30  },
  "MiniMax-M2.1":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "MiniMax-M2.5":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "MiniMax-M2.7":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "minimax-m2.1":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "minimax-m2.5":                 { input: 0.60,  output: 2.40,  cached: 0.30,  reasoning: 3.60,   cache_creation: 0.60  },

  // === Grok ===
  // https://docs.x.ai/docs/models (read 2026-11-20), prompts <200k tokens; >=200k bills
  // 2x input/cached/output (grok-4.7/4.6/4.5: 4/1.00/12; grok-4.3: 2.50/0.40/5), not modelled.
  "grok-4.7":                     { input: 2.00,  output: 6.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 0 }, // TODO(source): cache write unpublished
  "grok-4.6":                     { input: 2.00,  output: 6.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 0 }, // TODO(source): cache write unpublished
  "grok-4.5":                     { input: 2.00,  output: 6.00,  cached: 0.30,  reasoning: 6.00,   cache_creation: 0 }, // TODO(source): cache write unpublished
  "grok-4.3":                     { input: 1.25,  output: 2.50,  cached: 0.20,  reasoning: 2.50,   cache_creation: 0 }, // TODO(source): cache write unpublished
  "grok-code-fast-1":             { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },

  // === OpenRouter fallback ===
  "auto":                         { input: 2.00,  output: 8.00,  cached: 1.00,  reasoning: 12.00,  cache_creation: 2.00  },

  // === Misc ===
  "oswe-vscode-prime":            { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  "gpt-oss-120b-medium":          { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "vision-model":                 { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
  "coder-model":                  { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
};

/**
 * Provider-specific pricing overrides.
 * Only include entries where price DIFFERS from MODEL_PRICING.
 * Keyed by provider alias (cc, cx, gc, gh, ...) or provider id (openai, anthropic, ...).
 */
export const PROVIDER_PRICING = {
  // TypeSafe Jev — https://typesafe.ai/ (input $0.042/MTok, output free)
  typesafe: {
    "jev-latest": { input: 0.042, output: 0 },
  },
  // Cerebras — https://inference-docs.cerebras.ai/models/qwen-3.8-27b.md and /models/openai-oss.md
  // (read 2026-11-20). Cache rates are not stated -> 0.
  cerebras: {
    "gpt-oss-120b": { input: 0.35, output: 0.75, cached: 0, reasoning: 0.75 }, // TODO(source): cache rate unpublished
    "qwen-3.8-27b": { input: 0.99, output: 1.49, cached: 0, reasoning: 1.49 }, // TODO(source): cache rate unpublished
  },
  // Groq — https://console.groq.com/docs/models (read 2026-11-20). Cache rate not stated -> 0.
  groq: {
    "openai/gpt-oss-120b": { input: 0.15, output: 0.60, cached: 0, reasoning: 0.60 }, // TODO(source): cache rate unpublished
  },
  // Synthetic — https://synthetic.new/pricing/models, usage-based column, converted
  // from the vendor's per-token figures in GET /openai/v1/models (cached = cache read).
  // Subscription plans bill against a rate limit instead of these rates, so this is
  // the honest pay-as-you-go number, not the discounted plan rate.
  synthetic: {
    "hf:zai-org/GLM-5.3":                      { input: 1.40, output: 4.40, cached: 0.26, reasoning: 4.40 },
    "hf:zai-org/GLM-5.3-Flash":                { input: 0.15, output: 0.50, cached: 0.04, reasoning: 0.50 },
    "hf:zai-org/GLM-4.7-Flash":                { input: 0.10, output: 0.50, cached: 0.02, reasoning: 0.50 },
    "hf:moonshotai/Kimi-K3.1-Pro":             { input: 2.00, output: 10.00, cached: 0.20, reasoning: 10.00 },
    "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017": { input: 0.60, output: 1.20, cached: 0.03, reasoning: 1.20 },
    "hf:Qwen/Qwen3.8-27B":                     { input: 0.45, output: 2.20, cached: 0.09, reasoning: 2.20 },
    "hf:openai/gpt-oss-120b":                  { input: 0.10, output: 0.10, cached: 0.02, reasoning: 0.10 },
    // TODO(synthetic): the vendor pricing page lists no rate for these three ids —
    // they are in the static fallback only. Zero keeps them routable and bills $0
    // instead of silently using a lookalike model's rate; replace once published.
    "hf:moonshotai/Kimi-K3":                   { input: 0, output: 0, cached: 0, reasoning: 0 },
    "hf:deepseek-ai/DeepSeek-V4.1-Flash":      { input: 0, output: 0, cached: 0, reasoning: 0 },
    "hf:nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4": { input: 0, output: 0, cached: 0, reasoning: 0 },
    // Synthetic's aliases (syn:small|large:text|vision) are billed at the vendor's
    // published per-token API rates, the same usage-based numbers as the hf: ids —
    // NOT a rate-limit price. Source: GET /openai/v1/models `pricing{}`.
    "syn:small:text":                          { input: 0.10, output: 0.50, cached: 0.02, reasoning: 0.50 },
    "syn:small:vision":                        { input: 0.60, output: 1.20, cached: 0.03, reasoning: 1.20 },
    "syn:large:text":                          { input: 0.60, output: 1.20, cached: 0.03, reasoning: 1.20 },
    "syn:large:vision":                        { input: 2.00, output: 10.00, cached: 0.20, reasoning: 10.00 },
  },
  // CommandCode — the vendor catalog publishes per-model rates and the live
  // resolver registers them at runtime (see services/commandcodeModels.js), so a
  // newly released id bills correctly. This row covers the one static registry id
  // the pattern tables miss. Source: GET .../provider/v1/models?view=client
  commandcode: {
    "stepfun/Step-3.5-Flash": { input: 0.09, output: 0.30, cached: 0.02, reasoning: 0.30 },
  },
  // SenseNova (intl) — platform.sensenova.ai publishes no machine-readable price
  // list (the pricing pages 404 and /v1/models needs a key). TODO(sensenova-intl):
  // fill in the vendor's per-1M rates; zeros keep cost tracking visible, not silent.
  "sensenova-intl": {
    "sensenova-6.8-flash":      { input: 0, output: 0, cached: 0, reasoning: 0 },
    "sensenova-6.8-flash-lite": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "sensenova-6.7-flash-lite": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  // Cloudflare Workers AI Clef (input-only pricing; output tokens billed at $0).
  "cloudflare-ai": {
    "@cf/cloudflare/clef": { input: 0.24, output: 0 },
    "@cf/cloudflare/clef-flash": { input: 0.09, output: 0 },
  },
  // GitHub Copilot (gh) — explicit override, matches canonical gpt-5.3-codex rate
  gh: {
    "gpt-5.3-codex": { input: 1.75, output: 14.00, cached: 0.175, reasoning: 14.00, cache_creation: 1.75 },
  },
  // TokenRouter — exact rates from https://api.tokenrouter.com/api/pricing ($1/1M tokens).
  // Ratio→USD: input = model_ratio×2, output = model_ratio×completion_ratio×2.
  // These override the canonical MODEL_PRICING/PATTERN_PRICING, whose rates often
  // differ from TokenRouter's reseller pricing.
  tokenrouter: {
    "MiniMax-M3": { input: 0.3, output: 1.2, cached: 0.06, reasoning: 1.2 },
    "anthropic/claude-fable-5": { input: 10, output: 50, cached: 1.0, cache_creation: 12.5, reasoning: 50 },
    "anthropic/claude-haiku-4.5": { input: 1.0, output: 5.0, cached: 0.1, cache_creation: 1.25, reasoning: 5.0 },
    "anthropic/claude-opus-4.5": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-4.6": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-4.7": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-4.7-fast": { input: 30, output: 150, cached: 3.0, reasoning: 150 },
    "anthropic/claude-opus-4.8": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-4.8-fast": { input: 10, output: 50, cached: 1.0, cache_creation: 12.5, reasoning: 50 },
    "anthropic/claude-opus-5": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-5-fast": { input: 10, output: 50, cached: 1.0, cache_creation: 12.5, reasoning: 50 },
    "anthropic/claude-sonnet-4": { input: 3.0, output: 15.0, cached: 0.3, cache_creation: 3.75, reasoning: 15.0 },
    "anthropic/claude-sonnet-4.5": { input: 3.0, output: 15.0, cached: 0.3, cache_creation: 3.75, reasoning: 15.0 },
    "anthropic/claude-sonnet-4.6": { input: 3.0, output: 15.0, cached: 0.3, cache_creation: 3.75, reasoning: 15.0 },
    "anthropic/claude-sonnet-5": { input: 2, output: 10, cached: 0.2, reasoning: 10 },
    "claude-opus-4-8-m-aws": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "deepseek/deepseek-v3.2": { input: 0.26, output: 0.38, cached: 0.13, reasoning: 0.38 },
    "deepseek/deepseek-v4-flash": { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28 },
    "deepseek/deepseek-v4-flash-0731": { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28 },
    "deepseek/deepseek-v4-pro": { input: 0.435, output: 0.87, cached: 0.003625, reasoning: 0.87 },
    "ex/gpt-5.4": { input: 2.5, output: 15.0, cached: 0.25, reasoning: 15.0 },
    "google/gemini-2.5-flash-image": { input: 0.3, output: 2.5, reasoning: 2.5 },
    "google/gemini-3-flash-preview": { input: 0.5, output: 3.0, cached: 0.05, cache_creation: 0.08333, reasoning: 3.0 },
    "google/gemini-3-pro-image-preview": { input: 2, output: 12, reasoning: 12 },
    "google/gemini-3.1-flash-image-preview": { input: 0.5, output: 3.0, reasoning: 3.0 },
    "google/gemini-3.1-flash-lite-image": { input: 0.25, output: 1.5, reasoning: 1.5 },
    "google/gemini-3.1-pro-preview": { input: 2, output: 12, cached: 0.2, cache_creation: 0.375, reasoning: 12 },
    "google/gemini-3.5-flash": { input: 1.5, output: 9.0, cached: 0.15, cache_creation: 0.08333, reasoning: 9.0 },
    "google/gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cached: 0.03, cache_creation: 0.08333, reasoning: 2.5 },
    "google/gemini-3.6-flash": { input: 1.5, output: 7.5, cached: 0.15, cache_creation: 0.08333, reasoning: 7.5 },
    "google/gemini-embedding-2": { input: 1.0, output: 6.0, cached: 0.1, reasoning: 6.0 },
    "google/gemma-4-26b-a4b-it": { input: 0.06, output: 0.33, reasoning: 0.33 },
    "kling-3.0-turbo": { input: 2.1, output: 2.1, reasoning: 2.1 },
    "microsoft/mai-image-2.5": { input: 5.0, output: 47.0, reasoning: 47.0 },
    "minimax/minimax-m2-her": { input: 0.3, output: 1.2, cached: 0.03, reasoning: 1.2 },
    "minimax/minimax-m2.1": { input: 0.3, output: 1.2, cached: 0.03, reasoning: 1.2 },
    "minimax/minimax-m2.1-highspeed": { input: 0.6, output: 2.4, cached: 0.06, reasoning: 2.4 },
    "minimax/minimax-m2.5": { input: 0.3, output: 1.2, cached: 0.03, reasoning: 1.2 },
    "minimax/minimax-m2.7": { input: 0.3, output: 1.2, cached: 0.06, reasoning: 1.2 },
    "minimax/minimax-m2.7-highspeed": { input: 0.6, output: 2.4, cached: 0.06, reasoning: 2.4 },
    "miromind/mirothinker-1-7-deepresearch": { input: 4, output: 25.0, reasoning: 25.0 },
    "miromind/mirothinker-1-7-deepresearch-mini": { input: 1.25, output: 10.0, reasoning: 10.0 },
    "mistralai/devstral-2512": { input: 0.4, output: 2.0, cached: 0.04, reasoning: 2.0 },
    "mistralai/mistral-medium-3-5": { input: 1.5, output: 7.5, reasoning: 7.5 },
    "mistralai/mistral-small-2603": { input: 0.15, output: 0.6, cached: 0.015, reasoning: 0.6 },
    "mistralai/voxtral-small-24b-2507": { input: 0.1, output: 0.3, cached: 0.01, reasoning: 0.3 },
    "moonshotai/kimi-k2.5": { input: 0.6, output: 3.0, cached: 0.1, reasoning: 3.0 },
    "moonshotai/kimi-k2.6": { input: 0.95, output: 4.0, cached: 0.16, reasoning: 4.0 },
    "moonshotai/kimi-k2.7-code": { input: 0.9286, output: 3.8571, cached: 0.1857, reasoning: 3.8571 },
    "moonshotai/kimi-k3": { input: 3.0, output: 15.0, cached: 0.3, reasoning: 15.0 },
    "nvidia/nemotron-3-super-120b-a12b": { input: 0.3, output: 0.9, cached: 0.1, reasoning: 0.9 },
    "openai/gpt-4o-mini": { input: 0.15, output: 0.6, cached: 0.075, reasoning: 0.6 },
    "openai/gpt-5": { input: 1.25, output: 10.0, cached: 0.125, reasoning: 10.0 },
    "openai/gpt-5-image": { input: 10, output: 40, cached: 2.5, reasoning: 40 },
    "openai/gpt-5-image-mini": { input: 2.5, output: 8.0, cached: 0.25, reasoning: 8.0 },
    "openai/gpt-5-mini": { input: 0.25, output: 2.0, cached: 0.025, reasoning: 2.0 },
    "openai/gpt-5.2": { input: 1.75, output: 14.0, cached: 0.175, reasoning: 14.0 },
    "openai/gpt-5.3-codex": { input: 1.75, output: 14.0, cached: 0.175, reasoning: 14.0 },
    "openai/gpt-5.4": { input: 2.5, output: 15.0, cached: 0.25, reasoning: 15.0 },
    "openai/gpt-5.4-image-2": { input: 8, output: 30.0, cached: 2.0, reasoning: 30.0 },
    "openai/gpt-5.4-mini": { input: 0.75, output: 4.5, cached: 0.075, reasoning: 4.5 },
    "openai/gpt-5.4-nano": { input: 0.2, output: 1.25, cached: 0.02, reasoning: 1.25 },
    "openai/gpt-5.4-pro": { input: 30, output: 180, reasoning: 180 },
    "openai/gpt-5.5": { input: 5.0, output: 30.0, cached: 0.5, reasoning: 30.0 },
    "openai/gpt-5.5-pro": { input: 30, output: 180, reasoning: 180 },
    "openai/gpt-5.6-luna": { input: 0.2, output: 1.2, cached: 0.02, cache_creation: 0.25, reasoning: 1.2 },
    "openai/gpt-5.6-sol": { input: 5.0, output: 30.0, cached: 0.5, cache_creation: 6.25, reasoning: 30.0 },
    "openai/gpt-5.6-terra": { input: 2, output: 12, cached: 0.2, cache_creation: 2.5, reasoning: 12 },
    "openai/gpt-audio": { input: 2.5, output: 10.0, reasoning: 10.0 },
    "openai/gpt-audio-mini": { input: 0.6, output: 2.4, reasoning: 2.4 },
    "openai/gpt-oss-120b": { input: 0.039, output: 0.18, reasoning: 0.18 },
    "qwen/qwen3-coder-next": { input: 0.12, output: 0.75, cached: 0.06, reasoning: 0.75 },
    "qwen/qwen3.5-122b-a10b": { input: 0.26, output: 2.08, reasoning: 2.08 },
    "qwen/qwen3.5-35b-a3b": { input: 0.1625, output: 1.3, reasoning: 1.3 },
    "qwen/qwen3.5-397b-a17b": { input: 0.39, output: 2.34, reasoning: 2.34 },
    "qwen/qwen3.5-9b": { input: 0.1, output: 0.15, reasoning: 0.15 },
    "qwen/qwen3.5-flash": { input: 0.1048, output: 0.4194, reasoning: 0.4194 },
    "qwen/qwen3.5-plus-02-15": { input: 0.26, output: 1.56, reasoning: 1.56 },
    "qwen/qwen3.6-plus": { input: 0.54, output: 3.21, reasoning: 3.21 },
    "qwen/qwen3.7-max": { input: 1.25, output: 3.75, cached: 0.25, reasoning: 3.75 },
    "qwen/qwen3.7-plus": { input: 0.4, output: 1.6, cached: 0.08, reasoning: 1.6 },
    "qwen/qwen3.8-max": { input: 2, output: 6, cached: 0.25, cache_creation: 2.5, reasoning: 6 },
    "qwen3.5-omni-plus": { input: 1.0, output: 5.7143, reasoning: 5.7143 },
    "qwen3.6-flash": { input: 0.171, output: 1.029, cached: 0.017, cache_creation: 0.214, reasoning: 1.029 },
    "sakana/fugu-ultra": { input: 5.0, output: 30.0, cached: 0.5, reasoning: 30.0 },
    "seed-2-0-code-preview-260328": { input: 1.0, output: 6.0, cached: 0.2, cache_creation: 0.008333, reasoning: 6.0 },
    "seed-2-0-lite-260428": { input: 0.5, output: 4.0, cached: 0.1, cache_creation: 0.008333, reasoning: 4.0 },
    "seed-2-0-mini-260428": { input: 0.2, output: 0.8, cached: 0.04, cache_creation: 0.00833, reasoning: 0.8 },
    "seed-2-0-pro-260328": { input: 1.0, output: 6.0, cached: 0.2, cache_creation: 0.008333, reasoning: 6.0 },
    "stepfun/step-3.5-flash": { input: 0.1, output: 0.3, cached: 0.02, reasoning: 0.3 },
    "stepfun/step-3.7-flash": { input: 0.2, output: 1.15, cached: 0.04, reasoning: 1.15 },
    "tencent/hy3-preview": { input: 0.066, output: 0.26, cached: 0.029, reasoning: 0.26 },
    "x-ai/grok-4.1-fast": { input: 0.2, output: 0.5, cached: 0.05, reasoning: 0.5 },
    "x-ai/grok-4.20-beta": { input: 2, output: 6, cached: 0.2, reasoning: 6 },
    "x-ai/grok-4.3": { input: 1.25, output: 2.5, cached: 0.2, reasoning: 2.5 },
    "x-ai/grok-4.5": { input: 2, output: 6, cached: 0.5, reasoning: 6 },
    "x-ai/grok-build-0.1": { input: 1.0, output: 2.0, cached: 0.2, reasoning: 2.0 },
    "xiaomi/mimo-v2-flash": { input: 0.1, output: 0.3, cached: 0.01, reasoning: 0.3 },
    "xiaomi/mimo-v2-omni": { input: 0.4, output: 2.0, cached: 0.08, reasoning: 2.0 },
    "xiaomi/mimo-v2-pro": { input: 1.0, output: 3.0, cached: 0.2, reasoning: 3.0 },
    "xiaomi/mimo-v2.5": { input: 0.4, output: 2.0, cached: 0.08, reasoning: 2.0 },
    "xiaomi/mimo-v2.5-pro": { input: 1.0, output: 3.0, cached: 0.2, reasoning: 3.0 },
    "z-ai/glm-4.5-air": { input: 0.13, output: 0.85, cached: 0.025, reasoning: 0.85 },
    "z-ai/glm-4.6": { input: 0.6, output: 2.2, cached: 0.11, reasoning: 2.2 },
    "z-ai/glm-4.6v": { input: 0.3, output: 0.9, reasoning: 0.9 },
    "z-ai/glm-4.7": { input: 0.6, output: 2.2, cached: 0.11, reasoning: 2.2 },
    "z-ai/glm-5": { input: 1.0, output: 3.2, cached: 0.2, reasoning: 3.2 },
    "z-ai/glm-5-turbo": { input: 1.2, output: 4.0, cached: 0.24, reasoning: 4.0 },
    "z-ai/glm-5.1": { input: 1.05, output: 3.5, cached: 0.525, reasoning: 3.5 },
    "z-ai/glm-5.2": { input: 1.4, output: 4.4, cached: 0.26, reasoning: 4.4 },
    "z-ai/glm-5.3-free": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
};

// === Pricing backfill (T-29) ===
// Per-1M USD. Zero rows are explicit "cost not tracked" markers with a TODO(<provider>)
// reason; none is a claim that the model is free unless its source says so. Read 2026-11-20.
const BACKFILL_PRICING = {
  cerebras: {
    "zai-glm-4.7": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(cerebras): id absent from current public model list; no current price
    "llama-3.3-70b": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(cerebras): id absent from current public model list; no current price
    "llama-4-scout-17b-16e-instruct": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(cerebras): id absent from current public model list; no current price
  },
  "cloudflare-ai": {
    "@cf/meta/llama-3.2-1b-instruct": { input: 0.027, output: 0.201, cached: 0, reasoning: 0.201 }, // Source: https://developers.cloudflare.com/workers-ai/platform/pricing/
    "@cf/meta/llama-3.2-3b-instruct": { input: 0.051, output: 0.335, cached: 0, reasoning: 0.335 }, // Source: https://developers.cloudflare.com/workers-ai/platform/pricing/
    "@cf/meta/llama-3.1-8b-instruct-fp8-fast": { input: 0.045, output: 0.384, cached: 0, reasoning: 0.384 }, // Source: https://developers.cloudflare.com/workers-ai/platform/pricing/
    "@cf/meta/llama-3.1-8b-instruct-awq": { input: 0.123, output: 0.266, cached: 0, reasoning: 0.266 }, // Source: https://developers.cloudflare.com/workers-ai/platform/pricing/
    "@cf/mistralai/mistral-small-3.1-24b-instruct": { input: 0.351, output: 0.555, cached: 0, reasoning: 0.555 }, // Source: https://developers.cloudflare.com/workers-ai/platform/pricing/
    "@cf/meta/llama-3.1-70b-instruct-fp8-fast": { input: 0.293, output: 2.253, cached: 0, reasoning: 2.253 }, // Source: https://developers.cloudflare.com/workers-ai/platform/pricing/
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { input: 0.293, output: 2.253, cached: 0, reasoning: 2.253 }, // Source: https://developers.cloudflare.com/workers-ai/platform/pricing/
    "@cf/qwen/qwq-32b": { input: 0.66, output: 1, cached: 0, reasoning: 1 }, // Source: https://developers.cloudflare.com/workers-ai/platform/pricing/
  },
  cohere: {
    "command-r-plus-08-2024": { input: 2.5, output: 10, cached: 0, reasoning: 10 }, // Source: https://cohere.com/pricing (legacy pricing, existing customers)
    "command-r-08-2024": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(cohere): current pricing page lists neither version
    "command-a-03-2025": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(cohere): current pricing page lists neither version
  },
  fireworks: {
    "accounts/fireworks/models/llama-v3p3-70b-instruct": { input: 0.9, output: 0.9, cached: 0, reasoning: 0.9 }, // Source: https://docs.fireworks.ai/serverless/pricing (">16B parameters" tier; model not listed by name)
  },
  gemini: {
    "gemma-4-31b-it": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(gemini): Gemini API lists Gemma 4 as free tier only, paid tier not available
  },
  groq: {
    "llama-3.3-70b-versatile": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(groq): Groq models page shows Contact Sales only
    "meta-llama/llama-4-maverick-17b-128e-instruct": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(groq): shut down 2026-03-09 per console.groq.com/docs/deprecations
  },
  hyperbolic: {
    "meta-llama/Llama-3.3-70B-Instruct": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(hyperbolic): official USD table at hyperbolic.ai/docs/inference/overview.md (2026-10-21) doesn't list this id
    "meta-llama/Llama-3.2-3B-Instruct": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(hyperbolic): official USD table at hyperbolic.ai/docs/inference/overview.md (2026-10-21) doesn't list this id
    "NousResearch/Hermes-3-Llama-3.1-70B": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(hyperbolic): official USD table at hyperbolic.ai/docs/inference/overview.md (2026-10-21) doesn't list this id
  },
  mistral: {
    "mistral-large-latest": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(mistral): docs price Mistral Large 4 (0.70 / 2.10 / 0.07) but do not state that -latest maps to it
    "codestral-latest": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(mistral): docs price "Codestral" (0.3 / 0.9 / 0.03) but do not state that -latest maps to it
    "mistral-medium-latest": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(mistral): alias target (Medium 3.5) not in the pricing table; deprecated 2026-10-31
  },
  nebius: {
    "meta-llama/Llama-3.3-70B-Instruct": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(nebius): tokenfactory price page unreadable; only third-party figures found
  },
  nvidia: {
    "nvidia/nemotron-3.5-lightning-30b-a3b": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(nvidia): build.nvidia.com is a free prototype endpoint, no per-token price
    "nvidia/nemotron-3.5-bolt-e4b": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(nvidia): build.nvidia.com is a free prototype endpoint, no per-token price
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(nvidia): build.nvidia.com is a free prototype endpoint, no per-token price
    "nvidia/nemotron-3-ultra-550b-a55b": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(nvidia): build.nvidia.com is a free prototype endpoint, no per-token price
    "poolside/laguna-xs-2.1": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(nvidia): build.nvidia.com is a free prototype endpoint, no per-token price
    "meta/llama-guard-4-12b": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(nvidia): build.nvidia.com is a free prototype endpoint, no per-token price
    "nvidia/riva-translate-4b-instruct-v2": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(nvidia): build.nvidia.com is a free prototype endpoint, no per-token price
    "meta/llama-3.3-70b-instruct": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(nvidia): build.nvidia.com is a free prototype endpoint, no per-token price
  },
  ollama: {
    "gpt-oss:120b": { input: 0.15, output: 0.6, cached: 0.014, reasoning: 0.6 }, // Source: https://ollama.com/pricing (pay-as-you-go cloud)
  },
  openai: {
    "o3": { input: 2, output: 8, cached: 0.5, reasoning: 8 },
  },
  siliconflow: {
    "openai/gpt-oss-120b": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(siliconflow): page lists 0.05 / 0.45 with cache read 0.075 (above input), inconsistent; not adopted
    "inclusionAI/Ling-flash-2.0": { input: 0.14, output: 0.57, cached: 0, reasoning: 0.57 }, // Source: https://siliconflow.com/models/ling-flash-2-0
  },
  together: {
    "meta-llama/Llama-3.3-70B-Instruct-Turbo": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(together): only an unconfirmed 1.04 / 1.04 on a page that does not tie it to the Turbo id
    "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8": { input: 0.27, output: 0.85, cached: 0, reasoning: 0.85 }, // Source: https://www.together.ai/models/llama-4-maverick
  },
  venice: {
    "venice-uncensored-1-2": { input: 0.2, output: 0.9, cached: 0, reasoning: 0.9 }, // Source: https://docs.venice.ai/overview/pricing
    "zai-org-glm-5": { input: 1, output: 3.2, cached: 0.2, reasoning: 3.2 }, // Source: https://api.venice.ai/api/v1/models (cache_input)
    "llama-3.3-70b": { input: 0.7, output: 2.8, cached: 0, reasoning: 2.8 }, // Source: https://docs.venice.ai/overview/pricing
    "hermes-3-llama-3.1-405b": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(venice): absent from Venice catalog and pricing page (retired)
    "mistral-small-3-2-24b-instruct": { input: 0.09375, output: 0.25, cached: 0, reasoning: 0.25 }, // Source: https://docs.venice.ai/overview/pricing
  },
  "api-airforce": {
    "gpt-oss-120b": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(api-airforce): api.airforce prices are subscription credits (1 credit = 1 cent), not a USD list; unit inferred
    "gpt-oss-20b": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(api-airforce): api.airforce prices are subscription credits (1 credit = 1 cent), not a USD list; unit inferred
  },
  cline: {
    "kwaipilot/kat-coder-pro": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(cline): not in https://api.cline.bot/api/v1/ai/cline/models; no rate published
  },
  clinepass: {
    "cline-pass/mimo-v2.5": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(clinepass): flat-fee ClinePass subscription; docs give no rate for this MiMo V2.5 id
    "cline-pass/mimo-v2.5-pro": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(clinepass): flat-fee ClinePass subscription; docs give no rate for this MiMo V2.5 id
  },
  cursor: {
    "default": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(cursor): plan-based auto routing, no published per-token price
  },
  github: {
    "goldeneye-free-auto": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(github): Copilot plan-based free/auto router, no per-token price
  },
  kimchi: {
    "nemotron-3-ultra-fp4": { input: 0.6, output: 3.6, cached: 0, reasoning: 3.6 }, // Source: https://docs.kimchi.dev/docs/model-apis-pricing (cache rate unpublished)
  },
  "opencode-go": {
    "ox-alpha-free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(opencode-go): absent from the provider live catalog (only mimo-v2.6 listed); no rate published
    "longcat-2.0": { input: 0.3, output: 1.2, cached: 0.006, reasoning: 1.2 }, // Source: https://opencode.ai/inference/go/v1/models (provider catalog cost field)
    "mimo-v2.5": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(opencode-go): absent from the provider live catalog (only mimo-v2.6 listed); no rate published
    "mimo-v2.5-pro": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(opencode-go): absent from the provider live catalog (only mimo-v2.6 listed); no rate published
    "hy3": { input: 0.14, output: 0.58, cached: 0.035, reasoning: 0.58 }, // Source: https://opencode.ai/inference/go/v1/models
    "muse-spark-1.2-contributor": { input: 0.1, output: 0.2, cached: 0.002, reasoning: 0.2 }, // Source: https://opencode.ai/inference/go/v1/models; matches https://dev.meta.ai/docs/pricing-rate-limits (contributor mode, Meta may train on data)
    "muse-spark-1.3-contributor": { input: 0.1, output: 0.2, cached: 0.002, reasoning: 0.2 }, // Source: https://opencode.ai/inference/go/v1/models; matches https://dev.meta.ai/docs/pricing-rate-limits (contributor mode, Meta may train on data)
  },
  opencode: {
    "muse-spark-1.2-contributor-free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(opencode): id absent from the Zen/Go catalogs (-free/alpha id); no rate published
    "muse-spark-1.3-contributor-free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(opencode): id absent from the Zen/Go catalogs (-free/alpha id); no rate published
    "union-alpha": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(opencode): id absent from the Zen/Go catalogs (-free/alpha id); no rate published
  },
  "perplexity-web": {
    "pplx-auto": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(perplexity-web): web-session/subscription provider, no per-token price
    "pplx-sonar": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(perplexity-web): web-session/subscription provider, no per-token price
    "pplx-gpt": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(perplexity-web): web-session/subscription provider, no per-token price
    "pplx-gemini": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(perplexity-web): web-session/subscription provider, no per-token price
    "pplx-sonnet": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(perplexity-web): web-session/subscription provider, no per-token price
    "pplx-opus": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(perplexity-web): web-session/subscription provider, no per-token price
    "pplx-nemotron": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(perplexity-web): web-session/subscription provider, no per-token price
  },
  perplexity: {
    "sonar-pro": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(perplexity): Sonar chat completions rerouted to the Agent API (2026-09-27); official docs carry no Sonar rate card
    "sonar-reasoning-pro": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(perplexity): Sonar chat completions rerouted to the Agent API (2026-09-27); official docs carry no Sonar rate card
    "sonar-deep-research": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(perplexity): Sonar chat completions rerouted to the Agent API (2026-09-27); official docs carry no Sonar rate card
    "sonar": { input: 0.25, output: 2.50, cached: 0.0625, reasoning: 2.50 }, // Source: https://docs.perplexity.ai/docs/agent-api/models.md (same as perplexity-agent sonar; tool/search fees extra)
  },
  "perplexity-agent": {
    "perplexity/sonar": { input: 0.25, output: 2.5, cached: 0.0625, reasoning: 2.5 }, // Source: https://docs.perplexity.ai/docs/agent-api/models.md (tool/search fees extra)
    "nvidia/nemotron-3-super-120b-a12b": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(perplexity-agent): id not in the Agent API model list; no rate published
  },
  qoder: {
    "ultimate": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(qoder): credit-based subscription (tier multipliers, not dollars), no per-token price
    "performance": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(qoder): credit-based subscription (tier multipliers, not dollars), no per-token price
    "efficient": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(qoder): credit-based subscription (tier multipliers, not dollars), no per-token price
    "lite": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(qoder): credit-based subscription (tier multipliers, not dollars), no per-token price
    "qmodel_38max": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(qoder): credit-based subscription (tier multipliers, not dollars), no per-token price
    "qmodel_latest": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(qoder): credit-based subscription (tier multipliers, not dollars), no per-token price
    "qmodel": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(qoder): credit-based subscription (tier multipliers, not dollars), no per-token price
    "qfmodel": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(qoder): credit-based subscription (tier multipliers, not dollars), no per-token price
    "kmodel_latest": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(qoder): credit-based subscription (tier multipliers, not dollars), no per-token price
    "kmodel": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(qoder): credit-based subscription (tier multipliers, not dollars), no per-token price
    "gmodel": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(qoder): credit-based subscription (tier multipliers, not dollars), no per-token price
    "gfmodel": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(qoder): credit-based subscription (tier multipliers, not dollars), no per-token price
    "dmodel": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(qoder): credit-based subscription (tier multipliers, not dollars), no per-token price
    "dfmodel": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(qoder): credit-based subscription (tier multipliers, not dollars), no per-token price
    "mmodel": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(qoder): credit-based subscription (tier multipliers, not dollars), no per-token price
  },
  bazaarlink: {
    "auto:free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // Source: https://bazaarlink.ai/api/v1/models (free router, prompt/completion "0")
    "mimo-v2.5-pro": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(bazaarlink): absent from https://bazaarlink.ai/api/v1/models
    "mimo-v2.5": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(bazaarlink): absent from https://bazaarlink.ai/api/v1/models
    "nemotron-3-super-120b-a12b": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(bazaarlink): absent from https://bazaarlink.ai/api/v1/models
  },
  "kilo-gateway": {
    "kilo-auto/free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // Source: https://api.kilo.ai/api/gateway/models (free router)
    "nvidia/nemotron-3-super-120b-a12b:free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kilo-gateway): id absent from https://api.kilo.ai/api/gateway/models; no rate published
    "nvidia/nemotron-3-ultra-550b-a55b:free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // Source: https://api.kilo.ai/api/gateway/models (listed 0 / 0)
    "kwaipilot/kat-coder-pro-v2.5:free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kilo-gateway): id absent from https://api.kilo.ai/api/gateway/models; no rate published
    "kilo-auto/frontier": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kilo-gateway): catalog lists -1/-1 (variable price of the routed model)
    "kilo-auto/balanced": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kilo-gateway): catalog lists -1/-1 (variable price of the routed model)
  },
  morph: {
    "morph-v3-large": { input: 0.9, output: 1.9, cached: 0, reasoning: 1.9 }, // Source: https://morphllm.com/pricing
    "morph-v3-fast": { input: 0.8, output: 1.2, cached: 0, reasoning: 1.2 }, // Source: https://morphllm.com/pricing
    "morph-qwen35-397b": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(morph): id not on https://morphllm.com/pricing (only newer ids listed)
    "morph-minimax27-230b": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(morph): id not on https://morphllm.com/pricing (only newer ids listed)
    "morph-qwen36-27b": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(morph): id not on https://morphllm.com/pricing (only newer ids listed)
    "morph-dsv4flash": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(morph): id not on https://morphllm.com/pricing (only newer ids listed)
  },
  poolside: {
    "poolside/laguna-s-2.1": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(poolside): only an OpenRouter-endpoint price (0.10 / 0.20 / 0.01) was found, not a Poolside price page
    "poolside/laguna-xs-2.1": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(poolside): Poolside docs/blog publish no rate
    "poolside/laguna-m.1": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(poolside): Poolside docs/blog publish no rate
  },
  kenari: {
    "agnes-2-0-flash:free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): id absent from kenari.id/v1/models; no published price
    "agnes-2-5-flash:free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): id absent from kenari.id/v1/models; no published price
    "agnes-3-0-flash:free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): id absent from kenari.id/v1/models; no published price
    "gemma-4-31b-it": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): id absent from kenari.id/v1/models; no published price
    "gpt-oss-120b": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 630 / 3500 / 63), no USD rate; unit unclear, not converted
    "gpt-oss-20b": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 630 / 2700 / 65), no USD rate; unit unclear, not converted
    "hy3": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 2700 / 11000 / 270), no USD rate; unit unclear, not converted
    "hy3:free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): id absent from kenari.id/v1/models; no published price
    "laguna-s-2-1:free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): id absent from kenari.id/v1/models; no published price
    "laguna-xs-2-1:free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 1200 / 2500 / 1200 (listed free)), no USD rate; unit unclear, not converted
    "mimo-v2-5": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): id absent from kenari.id/v1/models; no published price
    "mimo-v2-5-pro": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): id absent from kenari.id/v1/models; no published price
    "mimo-v2-5:free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): id absent from kenari.id/v1/models; no published price
    "mistral-medium-3-5:free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): id absent from kenari.id/v1/models; no published price
    "muse-spark-1-2": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 20000 / 80000 / 2000), no USD rate; unit unclear, not converted
    "muse-spark-1-2-contributor": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 2000 / 4000 / 200), no USD rate; unit unclear, not converted
    "muse-spark-1-2-contributor:free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): id absent from kenari.id/v1/models; no published price
    "muse-spark-1-3": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 20000 / 80000 / 2000), no USD rate; unit unclear, not converted
    "muse-spark-1-3-contributor": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 2000 / 4000 / 200), no USD rate; unit unclear, not converted
    "muse-spark-1-3-contributor:free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): id absent from kenari.id/v1/models; no published price
    "nemotron-3-super-120b-a12b": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 1700 / 8400 / 170), no USD rate; unit unclear, not converted
    "nemotron-3-super-120b-a12b:free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): id absent from kenari.id/v1/models; no published price
    "nemotron-3-ultra-550b-a55b": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 12000 / 75000 / 1200), no USD rate; unit unclear, not converted
    "nemotron-3-ultra-550b-a55b:free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 12000 / 75000 / 4200 (listed free)), no USD rate; unit unclear, not converted
    "nex-n2-5-pro:free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): id absent from kenari.id/v1/models; no published price
    "north-mini-code:free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): listed free with null rates at kenari.id/v1/models
    "step-3-7-flash": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 4200 / 24000 / 840), no USD rate; unit unclear, not converted
    "step-3-7-flash:free": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(kenari): id absent from kenari.id/v1/models; no published price
  },
  muse: {
    "muse-spark-1.2-contributor": { input: 0.1, output: 0.2, cached: 0.002, reasoning: 0.2 }, // Source: https://dev.meta.ai/docs/pricing-rate-limits (contributor mode, Meta may train on data)
    "muse-spark-1.3-contributor": { input: 0.1, output: 0.2, cached: 0.002, reasoning: 0.2 }, // Source: https://dev.meta.ai/docs/pricing-rate-limits (contributor mode, Meta may train on data)
  },
  byteplus: {
    "seed-2-0-pro-260328": { input: 0.5, output: 3, cached: 0.1, reasoning: 3 }, // Source: https://docs.byteplus.com/docs/en/modelark/model-pricing.md (Standard tier, 0-128K prompt; 128-256K is 1.00 / 6.00 / 0.20)
    "seed-2-0-code-preview-260328": { input: 0.5, output: 3, cached: 0.1, reasoning: 3 }, // Source: https://docs.byteplus.com/docs/en/modelark/model-pricing.md (Standard tier, 0-128K prompt; 128-256K is 1.00 / 6.00 / 0.20)
    "seed-2-0-mini-260215": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(byteplus): page prices only the -260428 snapshot (or no gpt-oss row); a different snapshot rate is not copied
    "seed-2-0-lite-260228": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(byteplus): page prices only the -260428 snapshot (or no gpt-oss row); a different snapshot rate is not copied
    "gpt-oss-120b-250805": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(byteplus): page prices only the -260428 snapshot (or no gpt-oss row); a different snapshot rate is not copied
  },
  "codebuddy-cn": {
    "hy3": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(codebuddy-cn): CodeBuddy is a credit/subscription plan, no per-token price
  },
  iflow: {
    "iflow-rome-30ba3b": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(iflow): no iFlow price page found (plan/free tier)
  },
  mmf: {
    "mimo-auto": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(mmf): free-ai promotional endpoint; no price page found
  },
  "volcengine-ark": {
    "Doubao-Seed-2.0-Code": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(volcengine-ark): https://docs.volcengine.com/docs/82379/1544106 prices in CNY only (tiered), no USD stated
    "Doubao-Seed-2.0-pro": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(volcengine-ark): https://docs.volcengine.com/docs/82379/1544106 prices in CNY only (tiered), no USD stated
    "Doubao-Seed-2.0-lite": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(volcengine-ark): https://docs.volcengine.com/docs/82379/1544106 prices in CNY only (tiered), no USD stated
    "Doubao-Seed-Code": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(volcengine-ark): not on the official page; only press-quoted launch prices
  },
  "xiaomi-mimo": {
    "mimo-x-pro-preview": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(xiaomi-mimo): not on https://mimo.mi.com/docs/en-US/price/pay-as-you-go (v2.5 retired 2026-10-21; only v2.6 listed)
    "mimo-x-flash-preview": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(xiaomi-mimo): not on https://mimo.mi.com/docs/en-US/price/pay-as-you-go (v2.5 retired 2026-10-21; only v2.6 listed)
    "mimo-v2.5-pro": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(xiaomi-mimo): not on https://mimo.mi.com/docs/en-US/price/pay-as-you-go (v2.5 retired 2026-10-21; only v2.6 listed)
    "mimo-v2.5": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(xiaomi-mimo): not on https://mimo.mi.com/docs/en-US/price/pay-as-you-go (v2.5 retired 2026-10-21; only v2.6 listed)
    "mimo-v2-omni": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(xiaomi-mimo): not on https://mimo.mi.com/docs/en-US/price/pay-as-you-go (v2.5 retired 2026-10-21; only v2.6 listed)
    "mimo-v2-flash": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(xiaomi-mimo): not on https://mimo.mi.com/docs/en-US/price/pay-as-you-go (v2.5 retired 2026-10-21; only v2.6 listed)
  },
  "xiaomi-tokenplan": {
    "mimo-v2.6-pro": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(xiaomi-tokenplan): Token Plan is quota-based; pay-as-you-go rates do not apply to it
    "mimo-v2.6-flash": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(xiaomi-tokenplan): Token Plan is quota-based; pay-as-you-go rates do not apply to it
    "mimo-v2.5-asr": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(xiaomi-tokenplan): ASR billed per audio hour / TTS free for a limited time; no per-token price
    "mimo-v2.5-tts": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(xiaomi-tokenplan): ASR billed per audio hour / TTS free for a limited time; no per-token price
    "mimo-v2.5-tts-voiceclone": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(xiaomi-tokenplan): ASR billed per audio hour / TTS free for a limited time; no per-token price
    "mimo-v2.5-tts-voicedesign": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(xiaomi-tokenplan): ASR billed per audio hour / TTS free for a limited time; no per-token price
  },
  "codebuddy-intl": {
    "hy3-preview": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(codebuddy-intl): CodeBuddy is a credit/subscription plan, no per-token price
  },
  tencent: {
    "hunyuan-turbos-latest": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(tencent): cloud.tencent.com lists only the -vision variants (CNY); no price for this id
    "hunyuan-t1-latest": { input: 0, output: 0, cached: 0, reasoning: 0 }, // TODO(tencent): cloud.tencent.com lists only the -vision variants (CNY); no price for this id
  },
};
for (const [provider, table] of Object.entries(BACKFILL_PRICING)) {
  // Rows already in PROVIDER_PRICING win; the backfill only fills gaps.
  PROVIDER_PRICING[provider] = { ...table, ...PROVIDER_PRICING[provider] };
}

/**
 * Pattern-based pricing fallback — matched when no exact model entry found.
 * Patterns use simple glob: "*" matches any substring.
 * First match wins — order matters.
 */
export const PATTERN_PRICING = [
  // --- Codex variants ---
  { pattern: "*-codex-xhigh",   pricing: { input: 10.00, output: 40.00, cached: 5.00,  reasoning: 60.00,  cache_creation: 10.00 } },
  { pattern: "*-codex-high",    pricing: { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  } },
  { pattern: "*-codex-max",     pricing: { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  } },
  { pattern: "*-codex-mini-*",  pricing: { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  } },
  { pattern: "*-codex-mini",    pricing: { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  } },
  { pattern: "*-codex-low",     pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: "*-codex-none",    pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: "*-codex-spark",   pricing: { input: 3.00,  output: 12.00, cached: 0.30,  reasoning: 12.00,  cache_creation: 3.00  } },
  { pattern: "codex-*",         pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: "*-codex",         pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },

  // --- Claude ---
  { pattern: "claude-opus-*",   pricing: { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  } },
  { pattern: "claude-sonnet-*", pricing: { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  } },
  { pattern: "claude-haiku-*",  pricing: { input: 1.00,  output: 5.00,  cached: 0.10,  reasoning: 5.00,   cache_creation: 1.25  } },
  { pattern: "claude-*",        pricing: { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  } },

  // --- Gemini (specific first, generic last) ---
  { pattern: "gemini-*-flash-lite", pricing: { input: 0.15, output: 1.25, cached: 0.015, reasoning: 1.875, cache_creation: 0.15 } },
  { pattern: "gemini-*-flash",  pricing: { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.30  } },
  { pattern: "gemini-*-pro",    pricing: { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  } },
  { pattern: "gemini-4-*",      pricing: { input: 2.00,  output: 10.00, cached: 0.10,  reasoning: 10.00,  cache_creation: 0.1875 } },
  { pattern: "gemini-3-*",      pricing: { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  } },
  { pattern: "gemini-2.5-*",    pricing: { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.30  } },
  { pattern: "gemini-*",        pricing: { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  } },

  // --- GPT (specific first, generic last) ---
  { pattern: "gpt-5.6-*",       pricing: { input: 2.50,  output: 15.00, cached: 0.25,  reasoning: 15.00,  cache_creation: 2.50  } },
  { pattern: "gpt-5.3-*",       pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: "gpt-5.2-*",       pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: "gpt-5.1-*",       pricing: { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  } },
  { pattern: "gpt-5-*",         pricing: { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  } },
  { pattern: "gpt-5*",          pricing: { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  } },
  { pattern: "gpt-4o-*",        pricing: { input: 0.15,  output: 0.60,  cached: 0.075, reasoning: 0.90,   cache_creation: 0.15  } },
  { pattern: "gpt-4o",          pricing: { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  } },
  { pattern: "gpt-4*",          pricing: { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  } },

  // --- o1 / o-series ---
  { pattern: "o1-*",            pricing: { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  } },
  { pattern: "o1",              pricing: { input: 15.00, output: 60.00, cached: 7.50,  reasoning: 90.00,  cache_creation: 15.00 } },
  { pattern: "o3-*",            pricing: { input: 10.00, output: 40.00, cached: 5.00,  reasoning: 60.00,  cache_creation: 10.00 } },
  { pattern: "o4-*",            pricing: { input: 2.00,  output: 8.00,  cached: 1.00,  reasoning: 12.00,  cache_creation: 2.00  } },

  // --- Qwen ---
  { pattern: "qwen3-coder-*",   pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },
  { pattern: "qwen*-coder-*",   pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },
  { pattern: "qwen*",           pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },

  // --- Kimi ---
  { pattern: "kimi-*-thinking",  pricing: { input: 1.80,  output: 7.20,  cached: 0.90,  reasoning: 10.80,  cache_creation: 1.80  } },
  { pattern: "kimi-k3*",        pricing: { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.00  } },
  { pattern: "kimi-k2*",        pricing: { input: 1.20,  output: 4.80,  cached: 0.60,  reasoning: 7.20,   cache_creation: 1.20  } },
  { pattern: "kimi-*",          pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },

  // --- DeepSeek ---
  { pattern: "deepseek-*reasoner*", pricing: { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28, cache_creation: 0.14 } },
  { pattern: "deepseek-r*",     pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  } },
  { pattern: "deepseek-v*",     pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  } },
  { pattern: "deepseek-*",      pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  } },

  // --- GLM ---
  { pattern: "glm-5*",          pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },
  { pattern: "glm-4*",          pricing: { input: 0.75,  output: 3.00,  cached: 0.375, reasoning: 4.50,   cache_creation: 0.75  } },
  { pattern: "glm-*",           pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },

  // --- MiniMax ---
  { pattern: "MiniMax-*",       pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },
  { pattern: "minimax-*",       pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },

  // --- Grok ---
  { pattern: "grok-code-*",     pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },
  { pattern: "grok-*",          pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },
];

// Live-catalog rates published by a provider, keyed provider -> model -> pricing.
// CommandCode's catalog carries inputCost/outputCost/cacheReadCost/cacheWriteCost
// per model; registering them means a newly released id bills correctly without
// a LiteRouter release. Bounded and process-local.
const runtimePricing = new Map();
const RUNTIME_PRICING_MAX_MODELS = 1000;
// A rate above this is a unit mistake (e.g. per-token pasted as per-1M), not a
// real price; drop the entry rather than bill 1e6x too much.
const RUNTIME_RATE_MAX = 1000;
const RUNTIME_RATE_FIELDS = ["input", "output", "cached", "cache_creation", "reasoning"];

function isSaneRate(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= RUNTIME_RATE_MAX;
}

// Keep only finite, non-negative rates below the cap. An entry with a bad `input`
// or `output` is dropped whole; optional fields are dropped individually so a
// catalog that omits cache rates still prices the model.
function sanitizePricing(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (!isSaneRate(entry.input) || !isSaneRate(entry.output)) return null;
  const out = { input: entry.input, output: entry.output };
  for (const field of RUNTIME_RATE_FIELDS.slice(2)) {
    if (isSaneRate(entry[field])) out[field] = entry[field];
  }
  return out;
}

// Null-prototype store so a catalog id like "constructor" or "__proto__" cannot
// resolve to Object.prototype members.
export function setRuntimePricing(provider, entries) {
  if (!provider || !entries || typeof entries !== "object") return;
  const store = Object.create(null);
  for (const [model, entry] of Object.entries(entries).slice(0, RUNTIME_PRICING_MAX_MODELS)) {
    const clean = sanitizePricing(entry);
    if (clean) store[model] = clean;
  }
  runtimePricing.set(provider, store);
}

export function clearRuntimePricing(provider) {
  if (provider) runtimePricing.delete(provider);
  else runtimePricing.clear();
}

// Compiled per pattern once: capability/pricing lookups scan the full pattern
// tables (100+ globs, two tests each) on every request.
const patternRegexCache = new Map();
const PATTERN_REGEX_CACHE_MAX = 1000;
/**
 * Match a model ID against a glob pattern (* = wildcard). Case-insensitive:
 * registry ids mix casing (e.g. "MiniMax-M2.5" vs "minimax-m2.5").
 */
export function matchPattern(pattern, model) {
  let regex = patternRegexCache.get(pattern);
  if (!regex) {
    regex = new RegExp("^" + pattern.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
    if (patternRegexCache.size >= PATTERN_REGEX_CACHE_MAX) patternRegexCache.clear();
    patternRegexCache.set(pattern, regex);
  }
  return regex.test(model);
}

/**
 * Resolve pricing for a model using the 3-step fallback chain:
 *   1. PROVIDER_PRICING[provider][model]
 *   2. MODEL_PRICING[model]
 *   3. PATTERN_PRICING (glob match)
 *
 * @param {string} provider
 * @param {string} model
 * @returns {object|null}
 */
export function getPricingForModel(provider, model) {
  if (!model) return null;

  // 0. Runtime overlay — catalogs that publish their own rates (CommandCode's
  // live catalog does). Beats the static tables because the vendor is the source.
  // Object.hasOwn, not a truthy read: the store has a null prototype but the key
  // can still be "constructor"/"toString" from a catalog id.
  const overlay = runtimePricing.get(provider);
  if (overlay && Object.hasOwn(overlay, model)) return overlay[model];

  // 1. Provider-specific override. hasOwn throughout: a model id can be a
  // prototype member name ("constructor", "toString") straight from a catalog.
  if (provider && Object.hasOwn(PROVIDER_PRICING, provider)) {
    const providerTable = PROVIDER_PRICING[provider];
    if (providerTable && Object.hasOwn(providerTable, model)) return providerTable[model];
  }

  // 2. Canonical model pricing (strip vendor prefix if needed: "deepseek/deepseek-chat" → "deepseek-chat")
  const baseModel = model.includes("/") ? model.split("/").pop() : model;
  if (Object.hasOwn(MODEL_PRICING, baseModel)) return MODEL_PRICING[baseModel];
  if (Object.hasOwn(MODEL_PRICING, model)) return MODEL_PRICING[model];

  // 3. Pattern match
  for (const { pattern, pricing } of PATTERN_PRICING) {
    if (matchPattern(pattern, baseModel) || matchPattern(pattern, model)) {
      return pricing;
    }
  }

  return null;
}

/**
 * Get all provider pricing (for UI / API).
 * Returns PROVIDER_PRICING — consumers should fall back to MODEL_PRICING for unlisted models.
 */
export function getDefaultPricing() {
  return PROVIDER_PRICING;
}

/**
 * Format cost for display
 * @param {number} cost
 * @returns {string}
 */
export function formatCost(cost) {
  if (cost === null || cost === undefined || isNaN(cost)) return "$0.00";
  return `$${cost.toFixed(2)}`;
}

/**
 * Calculate cost from tokens and pricing
 * @param {object} tokens
 * @param {object} pricing
 * @returns {number} cost in dollars
 */
export function calculateCostFromTokens(tokens, pricing) {
  if (!tokens || !pricing) return 0;

  let cost = 0;

  const inputTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
  const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
  const cacheCreationTokens = tokens.cache_creation_input_tokens || 0;
  // prompt_tokens is cache-inclusive (see canonicalizeUsage): cached + cache_creation
  // are subsets, so subtract both to avoid charging them at the full input rate.
  const nonCachedInput = Math.max(0, inputTokens - cachedTokens - cacheCreationTokens);

  cost += nonCachedInput * (pricing.input / 1000000);

  if (cachedTokens > 0) {
    cost += cachedTokens * ((pricing.cached || pricing.input) / 1000000);
  }

  const outputTokens = tokens.completion_tokens || tokens.output_tokens || 0;
  cost += outputTokens * (pricing.output / 1000000);

  const reasoningTokens = tokens.reasoning_tokens || 0;
  if (reasoningTokens > 0) {
    cost += reasoningTokens * ((pricing.reasoning || pricing.output) / 1000000);
  }

  if (cacheCreationTokens > 0) {
    cost += cacheCreationTokens * ((pricing.cache_creation || pricing.input) / 1000000);
  }

  return cost;
}
