# Pricing

Rates live in `open-sse/providers/pricing.js`. Usage cost resolves a row with `getPricingForModel` and bills with `calculateCostFromTokens`; the dashboard pricing page edits the same rows through `/api/pricing`.

## What a row means

- **Every rate is USD per 1M tokens.** Fields are `input`, `output`, `cached`, `reasoning`, `cache_creation`; cost is `tokens * rate / 1000000`, and cached plus cache_creation tokens are subtracted from the cache-inclusive prompt before input is charged. Where: `calculateCostFromTokens`.
- **A missing cache or reasoning rate bills at the base rate.** The fallbacks are `pricing.cached || pricing.input`, `pricing.reasoning || pricing.output`, `pricing.cache_creation || pricing.input`, so an absent field and `0` mean the same thing: no discount. Never write `0` to mean "cache reads are free". Where: `calculateCostFromTokens`.
- **Resolution order**: runtime overlay (CommandCode catalog) → `PROVIDER_PRICING[provider][model]` → `MODEL_PRICING[model]` (a single `vendor/` prefix is stripped, then the full id is tried) → `PATTERN_PRICING`, first match wins, case-insensitive. The `pricing` kv scope (user overrides) is checked before the static resolver. Where: `getPricingForModel`, `src/lib/db/repos/pricingRepo.js`.
- **`PROVIDER_PRICING` rows beat the `BACKFILL_PRICING` placeholders** (the backfill is spread first), so publishing a real rate only needs the explicit row; the zero placeholder stays as the default.

## Zero rows

- **`input: 0, output: 0` means the model costs nothing to run here**: either the vendor publishes no per-token price for it, or it runs on a free plan (a `:free` id, a free tier). Cost tracking shows 0 for that model, which is the answer rather than a gap. 152 rows are zero today; 35 of them carry `free` in the id.
- **A zero row still counts as priced.** `getPricingForModel` returns the object, so `trackingGaps` stays quiet and the model looks tracked. Leaving the row out means "unknown" instead: $0 plus one warning, and the coverage test fails. Where: `open-sse/providers/trackingGaps.js`, `tests/unit/pricing-coverage.test.js`.
- **Every catalog chat model needs a row or an allowlist entry with a reason.** The allowlist (`tests/unit/fixtures/pricing-coverage-allow.json`) is empty today; it is the escape hatch for a model whose rate genuinely cannot be decided, not a way to skip a rate you have a source for.
- **A paid plan with an unpublished per-token rate gets a stand-in, not a zero.** An explicit zero hid real spend; a family list price overstates a prepaid plan rather than hiding it. Where: `PRICING_STAND_INS`.

## IDR-only vendors

- **Nothing converts currency.** There is no exchange-rate table and no `currency` field anywhere in the pricing path; all windows are USD per 1M tokens. Kenari publishes its prices in IDR and its quota endpoint reports IDR amounts, and neither is converted. Where: `open-sse/providers/registry/kenari.js` (`Indonesian aggregator (IDR pricing)`), `open-sse/services/usage/kenari.js` (`Monthly (IDR)` / `Weekly (IDR)` quota rows).
- **So a Kenari row is zero only for its free models** (`:free` ids and the free-plan ids), and a paid Kenari model has no Kenari row at all: it falls through to `MODEL_PRICING`/`PATTERN_PRICING` and bills at the model family's USD list price, which is not what Kenari charges in IDR. Do not invent a converted rate; add the vendor's own USD rate when it publishes one. Where: `getPricingForModel`.

## Adding a rate

1. **The vendor or gateway publishes its own USD per-token rate** → add `PROVIDER_PRICING[provider][model]`; it shadows the global row and every pattern.
2. **The id is vendor-agnostic** → add `MODEL_PRICING[model]`.
3. **A paid plan with no published per-token rate** → add a numeric row plus `PRICING_STAND_INS[provider][model] = { family, source }`. The pricing test walks each prepaid plan's registry ids and requires a stand-in entry with a source and a non-zero resolved rate, so a stand-in cannot appear silently; replace it when the vendor publishes the plan rate. Where: `tests/unit/provider-pricing-gateways.test.js`.
4. **A family of ids** → `PATTERN_PRICING`, specific glob before generic, first match wins. A specific id that matters gets its own row instead of relying on glob order.
5. **A free plan with nothing published** → an explicit zero row.
6. **Genuinely undecidable** → leave the model out and add `{ provider, model, reason }` to the coverage allowlist; CI stays green only with a reason.
- **Runtime catalog rates overlay the static tables and are validated**: non-finite, negative or above 1000 per 1M (a unit mistake) is dropped, at most 1000 models per provider, process-local. Where: `setRuntimePricing`, `isSaneRate`.
- **Users override any row without a deploy**: dashboard Settings → Pricing, or `PATCH /api/pricing` with `{ "<provider>": { "<model>": { "input": 2, "output": 10 } } }` (only the five rate fields, non-negative numbers). The row is stored per provider in the `pricing` kv scope and merged over the static row; `DELETE /api/pricing?provider=<p>&model=<m>` resets it. Where: `src/app/api/pricing/route.js`, `src/lib/db/repos/pricingRepo.js`.
