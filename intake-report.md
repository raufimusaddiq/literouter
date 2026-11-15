# Upstream Intake - 2026-11-15

- Ticket: T-25 (rig worker; manager `manager:t2`).
- Base: LiteRouter `main` at `bb2048465a54fb744d00b45639f9fc66e9e7df11`; previous intake ended at upstream `1339107e624d1ab150c6a0c2c2ee22caa7e9db2f` (v0.5.116). Upstream now: `1855aa44473e88feac9d3f131b9c0c5fc9706b68` (v0.5.119).
- Decision: **20 keep (10 hand-applied/adapted), 19 drop** across all 39 commits in `1339107e..1855aa44`.
- Branch: `intake/20261115-1855aa44` from `origin-literouter/main` (`bb204846`). Never based on or merged with `origin/master`.
- Method: upstream commits read as untrusted text, trial-applied in the ticket worktree, then integrated with `git cherry-pick -x` or by hand where LiteRouter has diverged. No upstream scripts or instructions were executed.
- Validation: `node --check` and acorn/acorn-jsx parses on every touched JS/JSX module, a use-before-define scan of the changed dashboard/React modules, plus the baseline verifiers. No local installs, builds or tests, per AGENTS.md. GitHub CI (`test.yml`) and the current-head Hermes review gate the merge.
- Release markers (`54a88d04`, `1855aa44`) are not taken, so `CHANGELOG.md` is untouched (also outside this ticket's scope).

## Owner decisions (2026-11-15)

The manager approved every recommendation below; entries marked **applied** are in this branch, **declined** are not.

- **Claude catalog — applied.** Add Claude Fable 5.2 and Haiku 5.5, retire Fable 5.1 from the advertised catalog (`8aef7480`, `10b0afa4`, `12e7930e`). Capability and pricing rows for 5.1 stay so an existing config still translates and bills correctly. `CLAUDE_CLI_VERSION` stays static at the bundled 2.1.295 (above Fable 5.2's 2.1.290 floor); the live npm version tracker is declined.
- **Antigravity Gemini 4 Carbon — applied.** Tiers plus bare alias and quota rows (`8aef7480`).
- **CommandCode models — applied.** Static `google/gemini-4-carbon` and `claude-fable-5-2` entries (`60a1b365`). Live catalog resolver declined (`fa73c938`): it adds a runtime public fetch to a dashboard route for no routing benefit the static list does not already give.
- **NVIDIA NIM catalog — applied** with the hardening (`2275bc0d`).
- **xiaomi-tokenplan catalog — applied.** The advertised ids were retired upstream on 2026-10-21 (`5e54377b`).
- **synthetic.new — declined.** New provider (`ebe398a9`, `402230ed`); not requested for LiteRouter and nothing routes to it today.
- **sensenova-intl — declined.** New provider (`14b27dc7`); the `.cn` provider LiteRouter already has is untouched.
- **Live Claude Code version + OAuth model list — declined** (`43bc940e`). Rewrites the `claude-cli/x.y.z` identity on every outgoing request from an npm lookup. LiteRouter keeps the pinned fingerprint.

## Kept

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

- `43bc940e` live Claude Code version + OAuth model list - owner declined (runtime npm identity rewrite).
- `fa73c938` CommandCode live catalog resolver - owner declined (runtime public fetch; static list covers the models).
- `ebe398a9`, `402230ed` synthetic.new provider and its key validation - owner declined (new provider).
- `14b27dc7` sensenova-intl provider - owner declined (new provider).
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

## Risk

- The NVIDIA catalogue marks `tools: false` on models (MiniMax, GLM, Nemotron Lightning/Nano/Ultra) where upstream probed no tool support. A client that needs tools on those ids now sees the capability missing rather than getting an upstream 400.
- `checkFallbackError` gained a `provider` argument. Rules without `provider` behave exactly as before; the only provider-scoped rule is the NIM "degraded" one. Call sites that do not pass a provider (the combo path) never match it.
- The OpenCode retry loop resends a failed request up to 8 times over ~20 s. It matches only bodies containing "overloaded" on 429, never the `FreeUsageLimitError` quota 429, and stops on abort — but a request that is genuinely slow to fail now takes longer to surface.
- Retiring `claude-fable-5-1` from the catalog affects users who picked it explicitly: the id still routes and bills correctly, but the dashboard no longer offers it. Re-add the registry line if that is unwanted.
- `applyQoderModelNames` only rewrites display names for qoder/qoder-cn (`qd`/`qdcn`); IDs and capabilities are untouched, so routing is unchanged.
- Rollback: revert the merge. No schema, migration or environment changes are included.
