# ADR-0022: Usage and token accounting semantics

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Providers report token usage in incompatible shapes: Claude excludes cache from `input_tokens` and splits usage across `message_start` and `message_delta`, OpenAI, Gemini and Ollama include cached tokens in the prompt, and Responses uses `input_tokens_details`. The gateway stores usage, computes cost, shows dashboards and forwards usage to clients across format translation. One convention and a set of invariants keep the numbers consistent; breaking them caused real under-reporting (for example 2012 reported where the real prompt was about 5344 with 5332 served from cache) and double counting (#130).

## Decisions

### D1. One storage convention: prompt_tokens is cache-inclusive

`canonicalizeUsage()` produces `prompt_tokens` = total input including cache read and creation, `cached_tokens` = cache-read portion (a subset of the prompt), `cache_creation_input_tokens` = cache-write portion (a subset), plus `completion_tokens`, `reasoning_tokens`, `total_tokens`. The discriminator is that Claude reports `cache_read_input_tokens` and/or `cache_creation_input_tokens` with a prompt that excludes cache, so cache is folded in; a first-write request carries only `cache_creation_input_tokens`, so both fields are checked. OpenAI and Gemini already include `cached_tokens` and pass through. It is idempotent: output always carries the `cached_tokens` key (even 0), so re-running takes the passthrough branch and never folds twice. `total_tokens` is recomputed after folding because an upstream total would be cache-exclusive. The nested `prompt_tokens_details.cached_tokens` and `cache_creation_tokens` shapes (the form `buildUsage()` and the Responses translator emit) are accepted as fallbacks, otherwise cache counts are silently dropped for Responses providers such as codex and grok-cli.

**Where:** `open-sse/utils/usageTracking.js`: `canonicalizeUsage`; `open-sse/handlers/chatCore/requestDetail.js`; `tests/unit/cached-token-usage.test.js`

### D2. Claude to OpenAI and back must not double count

Claude `message_start` carries input plus both cache buckets, while `message_delta` carries only output; usage is merged field-wise by max (`mergeUsage`), never overwritten, with a `Number.isFinite` guard so one malformed chunk cannot poison the accumulation (`Math.max(x, NaN)` is NaN). The claude-to-openai translator emits a cache-inclusive prompt with `cached_tokens` set, which is the marker that stops `canonicalizeUsage()` folding it a second time (#130), and builds usage from merged state rather than the delta alone. In the other direction (non-stream OpenAI or Responses to Claude) the cache-inclusive prompt is split into Claude's exclusive `input_tokens` plus separate cache fields, and the Kiro converter accepts both spellings because the Kiro executor emits the Chat shape while passthrough uses nested details.

**Where:** `open-sse/translator/response/claude-to-openai.js`; `open-sse/translator/response/nonstream-to-claude.js`; `open-sse/translator/response/kiro-to-claude.js`; `open-sse/utils/usageTracking.js`: `mergeUsage`; `open-sse/handlers/chatCore/nonStreamingHandler.js`; `tests/unit/claude-upstream-usage-double-count.test.js`

### D3. Extraction handles each provider shape and reports cache correctly

Responses usage (`input_tokens` with `input_tokens_details.cached_tokens`) is cache-inclusive and is emitted as `cached_tokens` so `canonicalizeUsage()` does not fold it; without this non-streaming codex and Responses traffic recorded `cached_tokens: 0`. Gemini payloads from Antigravity or gemini-cli are wrapped in `{ response: {...} }`. Ollama reports `prompt_eval_count`, `eval_count` and `prompt_eval_cached_count` at the top level, the cache count being a subset of the prompt. Translators may store OpenAI names (`completion_tokens`) or Claude names (`output_tokens`) (issue #3890). A request that failed with no usable usage (stall, reset) is the only case persisted with zero tokens, flagged `error`.

**Where:** `open-sse/handlers/chatCore/requestDetail.js`; `open-sse/translator/concerns/usage.js`; `open-sse/utils/usageTracking.js`; `tests/unit/extract-usage-cache-shapes.test.js`

### D4. Clients see usage exactly as reported; estimates are internal and never overstate

Usage is forwarded to the client exactly as the upstream sent it: no buffering and no fabricated finish-chunk usage. A missing usage is estimated at stream end, flagged `estimated`, and memoized. OpenAI clients get a usage chunk only when they set `stream_options.include_usage` (a spec-shaped trailing chunk with `choices: []` when upstream never sent one); Claude, Responses and Gemini wire formats need usage on the terminal event, so for those a missing usage is estimated. Estimates carry no safety buffer and must never overstate real use. The SSE-to-JSON handler re-attaches usage explicitly because a client was observed receiving no usage field at all even though the same object was written to the usage DB; a caller cannot tell a 90%-cached request from a cheap one without it, and the recorded detail uses the same cache-inclusive total so DB and client never disagree.

**Where:** `open-sse/utils/stream.js`: `emitIncludeUsageChunk`, flush; `open-sse/handlers/chatCore/sseToJsonHandler.js`; `open-sse/utils/usageTracking.js`

### D5. Dashboard display tolerates legacy rows and approximates cost split

Legacy Claude rows may have stored the prompt cache-exclusive, so `tokenDisplay` falls back to the cache count when it is larger, to avoid under-reporting input. The cost split in `UsageStats` is a token-share allocation of the rate-accurate server total, not a per-rate recompute; cached is a subset of the prompt so it is peeled out of the input share. A stored per-component cost breakdown would be needed for an exact cached-rate display. `saveRequestUsage` intentionally collapses rows sharing (timestamp, provider, model, connectionId, apiKey, tokens) so a retried or duplicated write does not double count.

**Where:** `src/web/pages/dashboard/usage/components/tokenDisplay.js`; `src/shared/components/UsageStats.js`; `src/lib/db/repos/usageRepo.js`: `saveRequestUsage`; `tests/unit/db-concurrent.test.js`

## Consequences

- Mixing cache-inclusive and cache-exclusive prompts under-reports tokens or double counts cache (#130) and corrupts cost.
- Overwriting instead of max-merging Claude usage zeroes cache counts; an unguarded NaN wipes accumulated totals.
- Dropping the `cached_tokens` marker or key makes canonicalization non-idempotent.
- Fabricating or buffering usage for clients, or over-estimating, misleads their budget and compaction logic.
- Treating dedup as a bug in `saveRequestUsage` would double count retried writes.
