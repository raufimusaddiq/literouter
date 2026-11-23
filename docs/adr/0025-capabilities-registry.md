# ADR-0025: Model capabilities registry and synced catalog

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

`open-sse/providers/capabilities.js` answers, per request, what a model can do: context window, max output, modalities, reasoning and thinking format. The answer drives history trimming (`stripHistoryForContext`), `applyThinking`, vision routing, `/v1/models` output and dashboard badges. It layers hand-written tables, provider overrides, name patterns and a synced models.dev catalog. Wrong numbers are not cosmetic: clients compact too early or never, thinking parameters get stripped, and images get dropped.

## Decisions

### D1. Resolution is layered; provider overrides and exact entries short-circuit

A hand-written `PROVIDER_CAPABILITIES` entry is the gateway's own number and wins over everything, including catalog data and glob patterns. An exact model entry short-circuits the pattern table, so its fields are not merged: exact entries must repeat the family fields (limits, reasoning, features) they want to keep, and this repetition is deliberate. Catalog modalities only ever turn a capability on. Catalog limits overlay the canonical exact entry so a gateway-specific delta (Copilot's 32k Claude output) publishes, but never overwrite a provider override. Gateway truncations therefore live in provider overrides (Kiro at 272k, Codex OAuth at 272k/372k, Copilot 32k Claude output, Devin CLI 200k GPT variants, SenseNova intl 262144/65536), scoped to that provider so same-id entries elsewhere keep their own values.

**Where:** `open-sse/providers/capabilities.js`: `getCapabilitiesForModel`, `PROVIDER_CAPABILITIES`; `tests/unit/gpt-6-context-window.test.js`

### D2. Pattern table order matters; first match wins

Patterns are globs (`*` wildcard), case-insensitive and anchored, so a pattern must match the full id. Vision and specific variants go before text-only or generic families so a broad pattern cannot swallow an exception (glm-4.6v versus glm-5). Concrete orderings: gpt-5.4 starts the 1.05M window, but the mini and nano tiers stayed at 400k and must be listed ahead of it; free tiers (":free" or "-free" suffix) match before the plain id. The generic gpt-6 pattern carries the API window (1.05M for astra, luna and sol), not Kiro's 272k, which had been copied into the global glob and published every other provider's gpt-6 models at 3.9x under their real window. Likewise `*glm-5.3*` pinned 200k and ran above `*glm-5*`; GLM-5.3 must not be under-counted (#4544) because 80% of the window drives history trimming.

**Where:** `open-sse/providers/capabilities.js`: pattern table; `tests/unit/gpt-6-context-window.test.js`; `tests/unit/glm53-context-window.test.js`; `open-sse/providers/models/namePatterns.js`

### D3. Unknown ids must not fall to defaults that disable reasoning

An id missing from the tables falls through to `DEFAULT_CAPABILITIES` (reasoning false), and `applyThinking()` then strips the client's `reasoning_effort` before it reaches the upstream (#2690). Newer OpenCode Free ids are therefore listed explicitly with models.dev modalities and limits. The OpenCode Free backend rejects prompts above about 330k tokens (#5097), so the published `context_length` must not exceed the real window or clients never compact. Newer Claude ids (opus 4.7/4.8/5, sonnet 5.5) need exact entries so they get 1M context and adaptive thinking instead of the generic `*claude*` budget pattern, which sent `thinking.type: "enabled"`, led the translator to forge signed thinking placeholders, and made Sonnet 5.5 answer large Codex conversations with stop_reason "refusal".

**Where:** `open-sse/providers/capabilities.js`; `tests/unit/capabilities.test.js`; `tests/unit/capabilities-opus-context.test.js`; `tests/unit/capabilities-sonnet-5-5.test.js`

### D4. The synced catalog is server-only and injected into a process-wide slot

`capabilities.js` is bundled into the dashboard's browser code, so it cannot import `node:fs`. The server installs the catalog reader through `setCatalogSource()` (from `catalogOverride.js`; Kenari has a similar hook). Because the server bundles this module into several route chunks, each with its own module state, the install must not land in a copy invisible to the one that resolves requests: the slot lives on `globalThis` and every read goes through it. Caching the reader locally would keep it alive in other copies after `setCatalogSource(null)`, which the sync does before rebuilding. The browser consequently falls back to generic patterns and under-reports limits, so the dashboard uses the server's answer carried by `/api/models`.

**Where:** `open-sse/providers/capabilities.js`: `setCatalogSource`, global catalog slot; `open-sse/providers/catalogOverride.js`: `installCatalogSource`; `open-sse/providers/kenariCatalog.js`; `src/web/pages/dashboard/combos/page.js`; `tests/unit/model-catalog-scope.test.js`

### D5. Catalog entries are scoped per provider plus model

Gateways disagree about the same weights (some do not proxy images) and truncate context and output differently, so both modalities and limits are keyed by provider + model in the local provider id space. Keying modalities by model id alone made short ids collide across vendors ("auto", "free" and "efficient" are router modes in one catalog and model names in another), so a router mode inherited a stranger's vision. The file is the source of truth: the in-memory parsed copy is dropped when the file mtime changes, so the per-request hot path is one stat (about 1 microsecond) and the parse (about 0.1 ms on about 18KB) reruns only after a sync. The file carries a schema version; an older file predates provider-scoped modality keys and is rebuilt rather than revalidated with a 304. Local provider ids must map to upstream ids (Copilot is "github" locally and "github-copilot" upstream), or the daily sync skips those models and stale hand-written numbers are never corrected.

**Where:** `open-sse/providers/catalogOverride.js`; `tests/unit/model-catalog-scope.test.js`; `tests/unit/gpt-6-context-window.test.js`

### D6. Table lookups use own-property tests

Catalog model ids are attacker-influenced strings, so a bare `table[id]` could resolve "constructor" or "toString" instead of a miss. Lookups use an own-property test, never a truthy read.

**Where:** `open-sse/providers/capabilities.js`: own-property lookup helper

### D7. CodeBuddy and Qoder use authoritative per-provider tables

CodeBuddy.cn per-model metadata mirrors the gateway's product-config payload (contextWindow = maxInputTokens, maxOutput = maxOutputTokens, vision = supportsImages); where server and plugin-baked fallback disagree the server wins. All models reason via OpenAI-style `reasoning_effort`. `thinkingCanDisable` maps to the server's `reasoning.canDisableThinking`, which is not the inverse of `onlyReasoning` (glm-5.3 and glm-5.3-flash are onlyReasoning but can disable thinking; hy* models are always on). deepseek-v4.1-flash replaces v4-flash (maxOutput 128000), and the intl entry mirrors CN with the openai-style reasoning format, because the generic deepseek-v4 pattern would pick the vendor-native thinking shape the gateway does not accept. Qoder exposes opaque ids (dfmodel, kmodel, ...) and capability lookup matches the raw id, so a map is needed or every model gets the 200K default. Its upstream window and output numbers under-report or arrive as 0, so values follow the real model family; every model reasons, but `thinkingCanDisable` is false everywhere because thinking is fixed upstream via `modelConfig.is_reasoning` and "none" must never be offered. CommandCode uses `/alpha/generate` for every model, so family patterns (deepseek-v4 thinking, vision false) must not win. Codex OAuth reports per-model windows lower than the 1.05M API window (#2720).

**Where:** `open-sse/providers/capabilities.js`: codebuddy-cn, codebuddy, qoder, commandcode, codex provider blocks

### D8. Model-specific facts recorded in exact entries

DeepSeek V4.1-Flash is natively multimodal (models.dev lists opencode-go/deepseek-v4.1-flash with image input), retired v4-flash and vision-exp ids route to it, and "deepseek-flash" is the GA id (1M window and 384k output; the generic pattern's 128K/64K limits are kept for the others). Hyphenated "deepseek-v4-1-flash" (Kenari) is an alias (#4293). v4.1+ has real image input (verified on Alibaba MaaS), whereas v4-pro and v4-flash-0731 accept image blocks but ignore them, so vision stays scoped to v4.* dotted releases. gpt-5.3-codex accepts images per models.dev, which the generic codex pattern would leave off. models.dev has no "search" flag, so `search` is set from vendor docs.

**Where:** `open-sse/providers/capabilities.js`: exact entries and pattern table; `tests/unit/capabilities.test.js`

### D9. Name-based vision detection is a last resort that only turns vision on

When neither the catalog nor the tables know a model, vendor naming ("qwen3-vl-plus", "glm-4.6v", "...-vision-exp") grants image input so a new model does not silently drop images. It never turns a declared capability off. Image generation, video generation and non-chat models carry these words but take no image input, so they are excluded first. The "<digit>v" suffix requires a dotted version so the never-shipped `gpt-4v` cannot match.

**Where:** `open-sse/providers/visionPatterns.js`

### D10. Models that route without a static row are logged once, fail-open

Live catalogs can surface ids with no pricing or capability row. They keep routing, but a silent $0 bill and the default 200k/64k floor hide the gap, so one bounded log line per id is emitted (no credentials, set size capped against hostile catalogs). Diagnostics must never break a request.

**Where:** `open-sse/providers/trackingGaps.js`

### D11. Context window is published in snake_case at top level

`/v1/models` emits `context_length` and related token limits at the top level under OpenAI/OpenRouter names. `capabilities.contextWindow` is camelCase and nested, so clients matching `context_length` find nothing, guess the window from the model name, and guess high (a 372k model read as 1.05M never compacts and hard-fails upstream). Not every client recurses into nested objects, and the `capabilities` block stays for compatibility.

**Where:** `src/app/api/v1/models/route.js`

### D12. Registry shape rules

Per-model `supportedFormats` guard the sourceFormat-matched transport for multi-endpoint providers (opencode-go: kimi/glm only do /chat/completions, minimax/qwen also /messages, deepseek also /responses). The registry oauth block is canonical for clientId, clientSecret and tokenUrl, injected into transport so executors reading `this.config.*` keep working. Name patterns are ordered, specific above generic. UI display config derives from `registry.display`, with the "RISK_NOTICE" token resolved at display time to avoid an import cycle. The add-provider form offers only methods that POST /api/providers can submit (a single credential string: API key, or cookie value for web-cookie providers); OAuth uses its own flow. The provider icon manifest is generated by prebuild/predev and committed so dev and tests work without it.

**Where:** `open-sse/providers/models/schema.js`; `open-sse/providers/index.js`; `open-sse/providers/models/namePatterns.js`; `src/shared/constants/providers.js`; `src/shared/constants/providersDisplay.js`; `scripts/gen-provider-icon-manifest.mjs`

## Consequences

- Putting a gateway's truncation into a global pattern misreports every other provider's window (the 3.9x gpt-6 error) and triggers early compaction or refusal.
- Reordering patterns or dropping repeated fields from exact entries silently changes tiers and loses limits, reasoning or features.
- Keying the catalog by model id alone, or caching the catalog reader per module copy, leaks capabilities across vendors or serves an uninstalled reader.
- Unlisted new model ids lose `reasoning_effort` and thinking behavior; Sonnet-5.x style ids can even be refused upstream.
- A bare `table[id]` lookup or a throwing diagnostic can break requests.
