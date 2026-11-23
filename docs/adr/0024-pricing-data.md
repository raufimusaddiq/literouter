# ADR-0024: Pricing data sourcing, units and lookup

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

`open-sse/providers/pricing.js` holds the static price tables (exact per-provider rows plus glob patterns) used to estimate request cost, with a runtime overlay for vendors that publish live catalogs (CommandCode). Prices come from many vendor pages that change often and that disagree on tiers, discounts and cache semantics. The comments in the file record where each block of numbers came from and which simplifications were chosen, so the numbers can be re-verified and so cost is never silently wrong.

## Decisions

### D1. Units, zero rows and cache semantics

All rates are USD per 1M tokens. A zero row is an explicit "cost not tracked" marker with a `TODO(<provider>)` reason (for example Kenari publishes IDR only); a zero is never a claim the model is free unless its source says so. Where a vendor page states no cache-write rate, `cache_creation` is 0 until one is published. `prompt_tokens` is cache-inclusive (see `canonicalizeUsage`), so cost calculation subtracts both cached and cache_creation tokens from the input before charging input at the full rate. Pattern pricing uses simple globs where `*` matches any substring, is case-insensitive (registry ids mix casing such as "MiniMax-M2.5" and "minimax-m2.5"), and the first match wins, so order matters. Rows already in `PROVIDER_PRICING` win over the backfill, which only fills gaps.

**Where:** `open-sse/providers/pricing.js`: `calculateCostFromTokens`, `matchPattern`, pattern table, `PROVIDER_PRICING`

### D2. Every block cites its source and read date; tiers are standard, short-context, post-intro

Each price block names its source URL and read date (mostly 2026-11-20), and uses the vendor's standard list tier. Simplifications are deliberate and recorded:

- OpenAI (GPT-6.2 Astra/Sol and others): standard tier, short context (<=272K input). Above 272K input bills higher (input/cache x2, output x1.5), not modelled. `cache_creation` is the 30-minute cache-write rate. Codex bills against subscription quota windows, so these are estimates there. Anthropic rows are the API list; three models differ from their family pattern and so have exact rows that a live OAuth catalog can surface the moment they ship.
- Gemini 4 (carbon/argon at 4 / 20 / 0.20; neon/hydrogen a single standard rate): standard rates, not the introductory 2 / 10 / 0.10 shown through 2026-11-30. gemini-3.8-flash / 3.6-flash stay at the post-intro list rate (the page shows 0.75 / 3.75 / 0.075 through 2026-12-31, then 1.50 / 7.50 / 0.15). The page states only an hourly cache-storage fee, so `cache_creation` is 0.
- DeepSeek: off-peak rate; peak (01-04 and 06-10 UTC Mon-Fri) is 2x (flash 0.006/0.30/1.20, v4-pro 0.044/1.32/3.96). deepseek-v4-flash is served by V4.1-Flash at the Flash price.
- xAI Grok: prompts below 200k tokens; at or above 200k bills 2x (grok-4.7/4.6/4.5: 4/1.00/12; grok-4.3: 2.50/0.40/5), not modelled.
- Tencent TokenHub (hy4 line): limited-time 50% discounts (hy4-flash to 2026-11-30, hy4 to 2026-12-31) are not applied; the region tab is not stated; cache write is blank so 0.
- BytePlus: Standard tier, 0-128K prompt (128-256K is 1.00 / 6.00 / 0.20).
- Cerebras and Groq: cache rates not stated, so 0. Perplexity: tool/search fees extra.
- Synthetic: the usage-based (pay-as-you-go) column converted from per-token figures in `GET /openai/v1/models`; subscription plans bill against a rate limit, so this is the honest pay-as-you-go number, and the `syn:` aliases use the same numbers as the `hf:` ids. TokenRouter: exact rates from `api.tokenrouter.com/api/pricing` ($1/1M tokens; input = model_ratio x 2, output = model_ratio x completion_ratio x 2), overriding the canonical tables whose rates often differ from its reseller pricing. Meta contributor-mode rows note that Meta may train on data.

**Where:** `open-sse/providers/pricing.js`: price tables per provider (comments cite source URLs)

### D3. Runtime catalog rates overlay and beat the static tables

Vendors that publish per-model rates (CommandCode: inputCost/outputCost/cacheReadCost/cacheWriteCost) are registered at runtime by `services/commandcodeModels.js`, so a newly released id bills at the real price without a LiteRouter release instead of $0. The overlay is looked up first (step 0 of `getPricingForModel`), ahead of provider-specific overrides, because the vendor is the source of truth. It is bounded (`RUNTIME_PRICING_MAX_MODELS`) and process-local. The one static CommandCode registry id the pattern tables miss keeps an explicit row.

**Where:** `open-sse/providers/pricing.js`: `setRuntimePricing`, `getPricingForModel`; `open-sse/services/commandcodeModels.js`

### D4. Catalog input is untrusted: sane-rate cap and prototype-safe lookup

A rate above `RUNTIME_RATE_MAX` (1000 per 1M) is a unit mistake (for example a per-token price pasted as per-1M), so the entry is dropped rather than billing 1e6x too much. Only finite, non-negative rates under the cap are kept; an entry with a bad `input` or `output` is dropped whole, while optional fields drop individually so a catalog without cache rates still prices the model. The runtime store is null-prototype and lookups use `Object.hasOwn`, because catalog ids such as "constructor", "toString" or "__proto__" must never resolve to `Object.prototype` members (note `__proto__` as an object-literal key sets the prototype, so it is not an own entry; the other three are legitimate ids that resolve to their own price).

**Where:** `open-sse/providers/pricing.js`: `isSaneRate`, `sanitizePricing`, `setRuntimePricing`, `getPricingForModel`; `tests/unit/provider-pricing-intake-models.test.js`

## Consequences

- Pricing changes without a source URL and read date cannot be re-verified; stale intro or discount rates silently mis-bill.
- Treating zero as "free" hides untracked models; treating per-token numbers as per-1M inflates costs by up to 1e6x.
- Not subtracting cached and cache_creation from prompt_tokens double-charges cached input.
- Unmodelled long-context and peak tiers make costs low-side estimates; this is accepted but must stay documented.
- Reading the overlay with plain property access exposes prototype members as prices for catalog ids like "constructor".
