# Upstream Intake - 2026-11-15

- Ticket: T-25 (rig worker; manager `manager:t2`).
- Base: LiteRouter `main` at `bb2048465a54fb744d00b45639f9fc66e9e7df11`; previous intake ended at upstream `1339107e624d1ab150c6a0c2c2ee22caa7e9db2f` (v0.5.116). Upstream now: `1855aa44473e88feac9d3f131b9c0c5fc9706b68` (v0.5.119).
- Decision: **20 keep (10 hand-applied/adapted), 19 drop** across all 39 commits in `1339107e..1855aa44`.
- Branch: `intake/20261115-1855aa44` from `origin-literouter/main` (`bb204846`). Never based on or merged with `origin/master`.
- Method: upstream commits read as untrusted text, trial-applied in the ticket worktree, then integrated with `git cherry-pick -x` or by hand where LiteRouter has diverged. No upstream scripts or instructions were executed.
- Validation: `node --check` and acorn/acorn-jsx parses on every touched JS/JSX module, a use-before-define scan of the changed dashboard/React modules, plus the baseline verifiers. No local installs, builds or tests, per AGENTS.md. GitHub CI (`test.yml`) and the current-head Hermes review gate the merge.
- Release markers (`54a88d04`, `1855aa44`) are not taken, so `CHANGELOG.md` is untouched (also outside this ticket's scope).

## Owner decisions (2026-11-20 — four 2026-11-15 declines reversed)

The owner reversed four decisions from the list below. Entries marked **reversed** were
dropped in the original intake and are now in this branch:

- **Claude live CLI version + OAuth model list — reversed** (`43bc940e`), with LiteRouter hardening: the npm lookup is bounded (3 s abort, 6 h cache, 10 min failure backoff, one in-flight), fails open to the pinned floor, and never awaits on the chat path. `CLAUDE_CLI_VERSION` stays **2.1.295** — the live value may only raise it, never lower it, so 2.1.295 remains the advertised floor and the pinned fixture in the baseline snapshots.
- **CommandCode live catalog — reversed** (`fa73c938`), bounded and cached (5 s timeout, 15 min success cache, 60 s failure backoff, single in-flight), returns null on any failure so both routes fall back to the static list (which still carries `google/gemini-4-carbon` + `claude-fable-5-2`). It also registers the catalog's own per-model rates as runtime pricing, so a newly released id bills correctly instead of $0.
- **synthetic.new — reversed** (`ebe398a9`, `402230ed`). Key validation probes `/v2/quotas` because `/openai/v1/models` answers 200 for any bearer and cannot reject a revoked key.
- **sensenova-intl — reversed** (`14b27dc7`), **scope narrowed**: chat models only. LiteRouter has no image-generation handler, so the vendor's `u1.x` image rows and `imageConfig` are not taken. See Risk — the `.cn` provider does not exist in this fork.

## Owner decisions (2026-11-15)

The manager approved every recommendation below; entries marked **applied** are in this branch, **declined** are not.

- **Claude catalog — applied.** Add Claude Fable 5.2 and Haiku 5.5, retire Fable 5.1 from the advertised catalog (`8aef7480`, `10b0afa4`, `12e7930e`). Capability and pricing rows for 5.1 stay so an existing config still translates and bills correctly. **Live CLI version — reversed 2026-11-20** (`43bc940e`), hardened as described above.
- **Antigravity Gemini 4 Carbon — applied.** Tiers plus bare alias and quota rows (`8aef7480`).
- **CommandCode models — applied, and the live catalog — reversed 2026-11-20.** Static `google/gemini-4-carbon` and `claude-fable-5-2` entries (`60a1b365`), plus the bounded live resolver (`fa73c938`) added in this branch; the static list remains the fallback when the fetch fails.
- **NVIDIA NIM catalog — applied** with the hardening (`2275bc0d`).
- **xiaomi-tokenplan catalog — applied.** The advertised ids were retired upstream on 2026-10-21 (`5e54377b`).
- **synthetic.new — reversed 2026-11-20.** New provider (`ebe398a9`, `402230ed`); key validation probes `/v2/quotas`.
- **sensenova-intl — reversed 2026-11-20.** New provider (`14b27dc7`), chat models only; LiteRouter has no image handler.
- **Live Claude Code version + OAuth model list — reversed 2026-11-20** (`43bc940e`). The npm lookup is bounded, cached and fail-open; the CLI floor stays 2.1.295.

## Kept

- `43bc940e` feat(claude): live model list via OAuth + auto-updating CLI version - **keep, hardened** (2026-11-20 owner reversal). `utils/claudeCliVersion.js` resolves the npm version with a 3 s abort, 6 h cache, 10 min failure backoff and a single in-flight lookup; `getClaudeCliVersion()` never returns below the pinned floor (2.1.295) and a `CLAUDE_CLI_VERSION` env pin is clamped up to it. `proxyAwareFetch` fires the refresh without awaiting, so the chat path never waits on npm. `/api/providers/[id]/models` queries Anthropic with the OAuth bearer + `oauth-2025-04-20` beta and falls back to the static catalog on error. The `muse` model-feed hunk from upstream is not taken (LiteRouter already has its own `muse` config).
- `fa73c938` fix(providers): resolve CommandCode models from its live catalog - **keep, hardened** (2026-11-20 owner reversal). `services/commandcodeModels.js` bounds the fetch (5 s), caches 15 min, backs off 60 s on failure and returns null on any error, so the dashboard route and `/v1/models` fall back to the static registry list. It also registers the catalog's per-model rates as runtime pricing (`setRuntimePricing`), so a model released after this build bills at the vendor's number rather than $0. Hidden catalog rows are dropped; the probe sends CLI identity headers and no connection key.
- `ebe398a9` feat(providers): add synthetic.new - **keep, adapted** (2026-11-20 owner reversal). Static `hf:` catalog plus `/openai/v1/models` in the dashboard; `/v2/quotas` usage handler with a plain message instead of an "unlimited" bar when no subscription limit is reported.
- `402230ed` fix(synthetic): validate keys against /v2/quotas - **keep, adapted** (2026-11-20 owner reversal). `transport.validateUrl` moves to `/v2/quotas` (a 401 for a revoked key, unlike the public models list); the validate route and the Test connection case both read it. The `CHANGELOG.md` hunk is not taken.
- `14b27dc7` fix(sensenova): add the international site provider - **keep, narrowed** (2026-11-20 owner reversal). `sensenova-intl` on `token.sensenova.ai`, chat models only; `quirks.reasoningAliasFields` and the non-streaming `message.reasoning` fallback are kept. The image rows/`imageConfig`, the `.cn` notice edit and the CHANGELOG hunk are not taken (see Risk).
- `cdcd09cc` fix(antigravity): strip ~optional from tool schemas - **keep** (cherry-pick). Antigravity 400s `Unknown name "~optional"`; dropped recursively at root, properties and array items.
- `aaf9b65f` fix(codex): advertise Codex CLI 0.167.1 - **keep, modified** (hand-applied). OpenAI started rejecting `codex_cli_rs/0.159.0` with 400 on 2026-11-10; identity headers and providers baseline move to 0.167.1. LiteRouter has no `codex-gpt6-lite.test.js`; the assertions live in `codex-gpt6-models.test.js`.
- `989b1eec` fix(opencode): retry free-lane overload 429 and drop rejected sessions - **keep, modified**. Retries only "overloaded" 429s (8 attempts, ~20 s backoff, abortable), and drops a minted `x-opencode-session` after a non-overload 429/403 so the next request re-mints (#5559). Hand-adapted: LiteRouter has no wreq-js TLS client, so the loop wraps plain `super.execute()`.
- `7abc190d` feat(models): expose thinking_levels - **keep, modified (partial)**. `/v1/models` publishes `thinking_levels` from `getThinkingLevels`. The opencode-settings half targets a cli-tools route LiteRouter does not ship.
- `29f3db11` fix(model): route bare claude-* ids to Claude OAuth - **keep, modified**. Bare `claude-*` stayed on `anthropic` and 404'd for OAuth-only users. LiteRouter resolves bare ids in `src/sse/services/model.js`, so the fallback is applied at that entry point instead of around `getModelInfoCore`.
- `7372d38d` fix(translator): always emit tool_result is_error for Zed Anthropic wire - **keep** (cherry-pick). Strict Anthropic wire parsers require `is_error` on every `tool_result`; Anthropic's own API accepts it as optional.
- `97b2c545` fix(compat): stop advertising zstd when the runtime cannot decode it - **keep, modified**. New `open-sse/utils/zstdCompat.js` derives `Accept-Encoding` from `zlib.createZstdDecompress`; applied in `grok-web` and `providers/validate`. LiteRouter has no `deepseek-web` executor, so that third call site is not part of this take.
- `2275bc0d` fix(nvidia): harden NIM - **keep, modified**. Strips the params NIM 400s, enables `dropClientMetadata`, caps the connect timeout at 90 s, adds the current NIM catalogue with capability profiles, and classifies "degraded" as a 15 min cooldown. LiteRouter's `ERROR_RULES` had no provider scoping, so `checkFallbackError` gains a `provider` argument and skips provider-scoped rules on mismatch; `auth.js` passes the provider. LiteRouter already locks per model, so the cooldown is model-scoped by construction.
- `ce1e0c3c` fix(quota): catch Claude resets missed between auto-ping ticks - **keep, modified**. Catches up an observed, due, unpinged cached deadline without marking the next window pinged, and keeps it pending across failures. LiteRouter has no anchored-schedule path (that machinery came from commits this fork does not carry), so the catch-up sits directly in the reactive path.
- `f4f5f183` fix(claude): rename tool_reference blocks when cloaking tools - **keep** (cherry-pick). Deferred tool loading's `tool_reference` blocks resolve against the suffixed `tools[]`; leaving them unsuffixed made Anthropic reject the request and the client disable tool search.
- `8aef7480` feat(providers): Claude Fable 5.2, Haiku 5.5, Gemini 4 Carbon - **keep** (owner decision). See above.
- `fe0d1a29` fix(usage): display Claude output_tokens in request details - **keep, modified**. `tokenDisplay.js` gains `getOutputTokens()` (completion_tokens, then output_tokens) and LiteRouter's third call site (the summary row) uses it too.
- `5f925cf9` feat(clinepass): quota tracker - **keep** (cherry-pick path; registry/usage/dashboard case). Reads `/api/v1/users/me/plan/usage-limits` with a WorkOS or plain API-key bearer.
- `597ee684` fix(qoder): show all catalog models and sync display names - **keep, modified**. Keeps `enable:false` entries (usable in the IDE), saves upstream display names on import via the existing upsert, and applies them in the provider page and model picker. LiteRouter has no `ModelsCard` or `selectableModels`, so those call sites are omitted. Added `clearQoderCatalog()` so the catalog cache can be reset in tests.
- `10b0afa4` feat(claude): Claude Fable 5.2 - **keep, modified**. Registry, capabilities and pricing; the CLI-version bump is unnecessary because LiteRouter already pins 2.1.295 (> 2.1.290).
- `12e7930e` fix(claude): retire Fable 5.1 from the catalogs - **keep**. Only the `claude` catalog carried 5.1 in LiteRouter; GitHub Copilot and OpenCode Zen never listed it. Capability and pricing rows stay.
- `60a1b365` feat(commandcode): gemini-4-carbon and claude-fable-5-2 - **keep** (owner decision).
- `9ae6e147` fix(stream): emit a single [DONE] sentinel in passthrough streams - **keep** (cherry-pick). Unterminated upstream `[DONE]` was forwarded raw and then framed again, producing one non-JSON event strict SSE clients reject.
- `4c7804ef` fix(pricing): bill gemini-4 models at their real rate - **keep** (cherry-pick path; `gemini-4-*` pattern ahead of the generic row). $2/$10 instead of the generic gemini $0.50/$3.00.
- `5e54377b` fix(xiaomi-tokenplan): update model list - **keep** (owner decision). Retired ids replaced by the current Token Plan catalog.

## Added by LiteRouter (not upstream)

- `tests/unit/zstd-compat.test.js`: pins `ACCEPT_ENCODING` to the runtime's zstd capability (the upstream commit shipped no test).
- `tests/unit/provider-pricing-gemini-4.test.js`: the gemini-4 pricing assertions lived in a CommandCode test this fork does not take.
- `tests/unit/xiaomi-tokenplan-catalog.test.js`: catalog, retired ids, modality kinds and shared-table wiring.
- `tests/unit/nvidia-params.test.js`: upstream's node:test file ported to vitest, plus a guard that the NIM degraded rule does not fire for other providers.
- `chore(intake)` baseline refresh: `providers-baseline.json` also picks up drift that was already on `main` and never snapshotted (`cloudflare-ai.systemOneTransport`, kimi's `openai-responses` transport, the `muse` provider in `alias-baseline.json`). `verify-providers` and `verify-alias` pass.

## Review follow-ups

Hermes requested changes on head `28eaf32e`; each finding is fixed with a code change on the same branch:

- **Provider page TDZ (blocker).** `providerAlias` is now declared before the `models` expression that passes it to `applyQoderModelNames`, so the provider detail page no longer throws on render. The other changed dashboard/React modules were scanned for the same pattern (see validation note above) and are clean.
- **Dead `modelScoped` flag removed.** `checkFallbackError` no longer returns it and the NIM "degraded" rule no longer carries it; nothing consumed it, because `auth.js` already locks per model through `buildModelLockUpdate(model, …)`. The NIM test asserts the 15 min cooldown only.
- **`sleep()` listener cleanup.** Both the timeout and abort paths now share one `cleanup()` that clears the timer, removes the abort listener and resolves, so a retry loop cannot accumulate handlers on the signal.

## Dropped

- `94f141dd` keep undici on 7.x - LiteRouter already pins `undici ^7.30.1` (the 8.x bump was never taken), and the `engines` floor is left to the packaging decision.
- `f8fd61aa` Input `htmlFor` - already implemented in LiteRouter's `Input` (`htmlFor={inputId}`, generated id when absent).
- `3a936d13` SearXNG in the Web Search picker - LiteRouter has no SearXNG provider, and no `selectableModels` module.
- `12256f72` proxy-pools filter and range selection - LiteRouter has no proxy-pools dashboard page (API only).
- `850eb573` explicit custom model type - LiteRouter's `AddCustomModelModal` has no STT/transport toggles, so the STT-flip bug cannot occur.
- `201e81fb` MiniMax desktop lease usage - no `mcode-lease` auth type in LiteRouter.
- `0760c302` Muse Web JSON cookie normalization - no muse-web executors (`webCookieAuth`/`webIdentity` are absent).
- `a76c2afc` OpenCode proxy through wreq-js - no wreq-js transport in LiteRouter.
- `0cf07ccf` fal key validation - no fal provider.
- `ec165e1c` STT undici FormData - no STT handler.
- `5bb041ed`, `85c91c4e` codex image fallback and native edits - no image-generation handler.
- `54a88d04`, `1855aa44` upstream release markers.

## Claude CLI fingerprint (advertised)

`claude-cli/x.y.z` in `User-Agent` and the `cc_version=` billing header both read
`getClaudeCliVersion()`:

- **Pinned floor: `2.1.295`** (`providers/shared.js` `CLAUDE_CLI_VERSION`, also the
  fail-open value and the pinned fixture in `providers-baseline.json` /
  `golden-url-header.test.js.snap`).
- **Raised live to** the latest `@anthropic-ai/claude-code` on npm, cached 6 h. Only
  a strictly greater version is adopted; an npm error, a malformed response or a
  timeout leaves 2.1.295 in place. `CLAUDE_CLI_VERSION=<x.y.z>` pins a version and
  is itself clamped up to the floor, so the fingerprint can never be downgraded.
- The rewrite happens in `proxyAwareFetch` for requests that already carry a
  `claude-cli/` header, so no other provider's identity is touched.

## Model tracking

Every model this ticket introduces or exposes. Pricing rows live in
`open-sse/providers/pricing.js` (rates are $/1M tokens), capability rows in
`open-sse/providers/capabilities.js`. Ids without a static row still route; a
single bounded `[model-tracking]` warning per id makes the gap visible
(`open-sse/providers/trackingGaps.js`, called from the cost path and both live
catalog routes).

| model id | provider | pricing source | caps source |
| --- | --- | --- | --- |
| `claude-sonnet-5-5` | claude (live OAuth list) | anthropic.com/pricing — $2 / $10 / $0.10 read / $2.50 write | anthropic.com/pricing + `/v1/models` (1M ctx, 128k out, adaptive thinking) |
| `claude-sonnet-5` | claude (live OAuth list) | anthropic.com/pricing — $2 / $10 / $0.20 read | same |
| `claude-opus-5-5` | claude (live OAuth list) | anthropic.com/pricing — $4 / $20 / $0.20 read / $5 write | same |
| `claude-opus-5`, `claude-opus-4-8`, `claude-haiku-5-5`, `claude-fable-5-2`, `claude-sonnet-4-6` | claude (live OAuth list) | already priced (`MODEL_PRICING`) | already capped |
| `hf:zai-org/GLM-5.3` | synthetic | synthetic.new/pricing/models — $1.40 / $4.40 / $0.26 read | `/openai/v1/models` (524288 ctx, 65536 out, text) |
| `hf:zai-org/GLM-5.3Beta` | synthetic | vendor charges the GLM-5.3 rate — $1.40 / $4.40 / $0.26 read | `/openai/v1/models` (text) |
| `hf:zai-org/GLM-5.3-Flash` | synthetic | $0.15 / $0.50 / $0.04 read | `/openai/v1/models` (vision) |
| `hf:zai-org/GLM-4.7-Flash` | synthetic | $0.10 / $0.50 / $0.02 read | `/openai/v1/models` (196608 ctx, text) |
| `hf:moonshotai/Kimi-K3.1-Pro` | synthetic | $2.00 / $10.00 / $0.20 read | `/openai/v1/models` (524288 ctx, vision) |
| `hf:deepseek-ai/DeepSeek-V4.1-Flash-1017` | synthetic | $0.60 / $1.20 / $0.03 read | `/openai/v1/models` (vision) |
| `hf:Qwen/Qwen3.8-27B` | synthetic | $0.45 / $2.20 / $0.09 read | `/openai/v1/models` (262144 ctx, vision) |
| `hf:openai/gpt-oss-120b` | synthetic | $0.10 / $0.10 / $0.02 read | `/openai/v1/models` (131072 ctx, text) |
| `hf:moonshotai/Kimi-K3`, `hf:deepseek-ai/DeepSeek-V4.1-Flash`, `hf:nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4` | synthetic | **unpublished** → explicit `$0` with `TODO(synthetic)`; the vendor page lists no rate | `/openai/v1/models` (vision/text as reported) |
| `syn:small:text`, `syn:small:vision`, `syn:large:text`, `syn:large:vision` | synthetic (plan aliases) | vendor per-token figures from `/openai/v1/models` (plan usage bills the rate limit instead) | `/openai/v1/models` |
| `sensenova-6.8-flash`, `sensenova-6.8-flash-lite`, `sensenova-6.7-flash-lite` | sensenova-intl | **unpublished** → explicit `$0` with `TODO(sensenova-intl)`; the vendor pricing pages 404 and `/v1/models` needs a key | `token.sensenova.ai/v1/models` (262144 ctx, 65536 out, vision, reasoning) |
| every static CommandCode id (13) + any live id | commandcode | static table, and the live catalog's own `pricing{}` registered via `setRuntimePricing` at fetch time | provider-level rule (1M ctx, 384k out, vision unless the text-only set matches) |
| any other live id from the Claude OAuth or CommandCode catalogs | claude / commandcode | none — pattern fallback may still match; otherwise `noteUntrackedModel` logs once | same |

## Risk

- **No `.cn` SenseNova provider.** This fork never carried `351b04cb`, so `sensenova-intl` ships alone. The earlier "`.cn` is untouched" note was wrong: there is nothing to touch. An international key works; a China-site key has no provider here. Add `open-sse/providers/registry/sensenova.js` (chat models only) if that account class matters.
- **Live lookups cost a request each.** The Claude npm probe is 3 s and every 6 h; the CommandCode catalog is 5 s and every 15 min per process. Both fail open but a slow network can still burn that time in the background (never on the chat path).
- **Live catalog ids can outrun the static tables.** They route, and CommandCode's own rates are now registered, but a Claude id newer than `MODEL_PRICING` bills through the `claude-*` pattern until its row is added; `[model-tracking]` warns once per id so the gap is visible rather than silent.
- **Sensenova and synthetic `$0` rows are deliberate.** They are explicit "unknown", not free models: `TODO(...)` marks each row. A dashboard cost figure for those ids understates spend until the vendor publishes rates.
- **`getClaudeCliVersion()` can adopt an npm version Anthropic has not yet gated models on.** It only ever raises the fingerprint, and Anthropic accepts newer clients, but a future hostile publish of `@anthropic-ai/claude-code` would be adopted until the 6 h cache expires. Set `CLAUDE_CLI_VERSION` to pin it if that matters.

- The NVIDIA catalogue marks `tools: false` on models (MiniMax, GLM, Nemotron Lightning/Nano/Ultra) where upstream probed no tool support. A client that needs tools on those ids now sees the capability missing rather than getting an upstream 400.
- `checkFallbackError` gained a `provider` argument. Rules without `provider` behave exactly as before; the only provider-scoped rule is the NIM "degraded" one. Call sites that do not pass a provider (the combo path) never match it.
- The OpenCode retry loop resends a failed request up to 8 times over ~20 s. It matches only bodies containing "overloaded" on 429, never the `FreeUsageLimitError` quota 429, and stops on abort — but a request that is genuinely slow to fail now takes longer to surface.
- Retiring `claude-fable-5-1` from the catalog affects users who picked it explicitly: the id still routes and bills correctly, but the dashboard no longer offers it. Re-add the registry line if that is unwanted.
- `applyQoderModelNames` only rewrites display names for qoder/qoder-cn (`qd`/`qdcn`); IDs and capabilities are untouched, so routing is unchanged.
- Rollback: revert the merge. No schema, migration or environment changes are included.
