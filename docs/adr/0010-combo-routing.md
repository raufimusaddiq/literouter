# ADR-0010: Model combos: fallback, capacity and fusion

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

A combo is a named list of models that the router expands and tries in order (or, for fusion, fans out to). `open-sse/services/combo.js` handles fallback, capability-aware ordering and fusion; `capacityAdapter.js` adds global fallback pools for input modalities; the combo APIs validate stored combos. Each member attempt can be a billed generation, and a wrongly routed request can silently drop user data such as images. These decisions define how combos choose, retry and stop.

## Decisions

### D1. Never re-generate after client leave or a 504

If the client aborts, the combo ends and no further member is started, because each member call is a billed generation. A gateway 504 may already be a billed generation, so it also ends the whole combo and is never retried on the next member. Neither is treated as a member failure to fall past.

**Where:** `open-sse/services/combo.js`: `handleComboChat`

### D2. Hard capabilities must be prioritized; only the current turn counts

Hard capabilities are input modalities (vision, pdf, audio, video): a model lacking one drops request data, for example a stripped image, so it must be prioritized. Soft capabilities such as search only degrade a feature. Modalities are detected on the trailing run of items after the last assistant/model turn, which can span several messages (text and image split across blocks). Media in older history must not pin the combo to a vision model; it is stripped and placeholdered downstream.

**Where:** `open-sse/services/combo.js`: `reorderByCapabilities`, `trailingUserItems`, `detectRequiredCapabilities`

### D3. Capacity adapter pools are an opt-in fallback behind existing models

`capacityAdapter.js` appends per-capability fallback pools (vision, pdf, audioInput, videoInput) behind the models already going to be tried. Adapter models are prepended as priority candidates only when none of the original models can satisfy the required capabilities; otherwise the list is left alone and `reorderByCapabilities` handles it, so a combo with a capable member is never overridden. An enabled pool with no models is a no-op: the user cleared every model on purpose, and substituting a model they cannot see is worse. The dashboard therefore starts entries disabled, and normalizes the legacy stored form (an array of {model, enabled}). Trimmed history sent to an adapter model is capped at 80% of its context window to leave room for the response.

**Where:** `open-sse/services/capacityAdapter.js`: `getCapacityAdapterConfig`, `augmentModelsWithCapacityAdapter`, `stripHistoryForContext`; `src/app/(dashboard)/dashboard/combos/page.js`

### D4. Wait out transient 502/503 before falling through

For transient errors a briefly overloaded provider gets a cooldown wait so it can recover instead of being skipped immediately. 504 never reaches this path, per D1.

**Where:** `open-sse/services/combo.js`: `handleComboChat`

### D5. All-members-failed returns 503, not 406

406 implies the request itself is invalid, but here providers are unavailable or lack active credentials. 503 is accurate and retryable by clients.

**Where:** `open-sse/services/combo.js`: `handleComboChat`

### D6. Unmatched 400s are returned; provider-scoped 400s rotate seats

The combo must pass the provider id to the error classifier. Provider-scoped rules, such as an NVIDIA seat failing with a 400 "degraded", then rotate to the next seat. A 400 matching no rule is a request-scoped client error and is returned as-is instead of rotating.

**Where:** `open-sse/services/combo.js`: `handleComboChat`; `tests/unit/combo-provider-fallback.test.js`

### D7. Fusion: panel non-streaming without tools, judge analyzes

Fusion fans the prompt to every panel model in parallel, then a judge writes one answer. Panel calls are forced non-streaming with tools stripped, since the judge needs complete prose, and `stream_options` is dropped too because providers such as DeepSeek reject it unless stream=true (issue #3024). The judge keeps the client's stream flag and tools. Following OpenRouter's Fusion design the judge does not merge: it analyzes consensus, contradictions, partial coverage, unique insights and blind spots, then writes an answer grounded in that; about three quarters of the quality lift comes from this step. Sources are anonymized ("Source N") so substance outweighs brand reputation. Zero panel answers returns 503; exactly one is returned directly.

**Where:** `open-sse/services/combo.js`: `handleFusionChat`, `buildJudgePrompt`

### D8. Panel collection uses quorum-grace

As soon as `minPanel` calls succeed, a short grace timer starts for the rest and the combo proceeds with whatever arrived. This caps the straggler penalty while still preferring a full panel when all models are fast, and a hard timeout bounds the wait. Results are a sparse array aligned to the calls.

**Where:** `open-sse/services/combo.js`: `collectPanel`

### D9. Combos must not contain themselves

A combo that transitively contains itself would expand forever in chat.js, so write paths reject cycles up front and expansion also caps depth for combos stored before the check existed. PUT validates the merged result, not just the patch, because a rename or a models edit can each close a cycle.

**Where:** `src/app/api/combos/validate.js`; `src/app/api/combos/[id]/route.js`: `PUT`

### D10. Combo limits aggregate members, with a server override

A combo's limits are the conservative aggregate of its members: context is the minimum, max output the maximum. Resolving members needs the synced model catalog, which is server-only, so the browser falls back to generic patterns and under-reported (badge 200k versus 1M from /v1/models). `resolveCaps` lets a caller pass the server's answer; it overrides only what it carries, and local tables still own tools/pdf/audio/video/thinking.

**Where:** `tests/unit/combo-caps-resolver.test.js` (behavior of `resolveCaps`)

## Consequences

- Retrying after a 504 or client abort causes duplicate billed generations.
- Letting history media pin the combo to a vision model, or ignoring hard capabilities, either misroutes cheap requests or drops images.
- Auto-substituting models in an empty capacity pool changes behavior the user cannot see.
- Fusion panel calls with tools or stream_options break on strict providers and starve the judge.
- Accepting a cyclic combo hangs request expansion.
