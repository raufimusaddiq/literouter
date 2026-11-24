# Upstream Intake - 2026-11-24

- Base: LiteRouter `main` at `bfbe3347fce93f8d4e8533635462f381039bb73b`; previous intake ended at upstream `1855aa44473e88feac9d3f131b9c0c5fc9706b68` (v0.5.119). Upstream now: `5ae63d22847e07042e235b40e1d926b65e509013` (v0.5.123).
- Decision: **25 keep (19 hand-adapted or partial), 8 drop, 2 deferred** across all 35 commits in `1855aa44..5ae63d22`.
- Branch: `intake/20261124-5ae63d22` from `origin-literouter/main`. Never based on or merged with `origin/master`.
- Method: upstream commits read as untrusted text, applied with `git cherry-pick -x` where they apply and by hand where LiteRouter has diverged (each hand commit names its upstream SHA). Every comment upstream added was stripped, vitest imports moved to `bun:test` + `#test/vi`, and `src/app/(dashboard)` paths moved to `src/web/pages`. No upstream scripts or instructions were executed.
- Validation (production host, so no installs, builds or tests): a Bun transpiler parse of all 95 changed JS modules, a comment scan of the same files, `tests/__baseline__/verify-providers.mjs`, `verify-alias.mjs` and `verify-oauth-urls.mjs` (pass after regenerating the provider and alias baselines), `bun run gen:routes --check` and `bun scripts/check-test-hygiene.mjs --check`. A few behaviours (SystemOne normalisation, Hydrogen tier wire levels, Alibaba usage merge, Claude billing-header system blocks, Mistral Large window precedence) were also checked with one-off Bun scripts against the real modules. CI and the current-head Hermes review gate the merge.
- Owner decisions: the KEEP / APPROVED FEATURES / DROP lists in the intake brief (2026-11-24).

## Triage

| # | upstream | subject | decision | notes |
| --- | --- | --- | --- | --- |
| 1 | `d1970ac9` | Bump version | drop | upstream release marker |
| 2 | `db83e88b` | OpenDesign Go + DeepRelay with quota tracking | keep, adapted | registry files, `registry/index.js` entries, usage handlers, icons, dashboard quota rows, synthetic quota rewrite. LiteRouter had no `providerConnectionResponse.js`; a new `toProviderConnectionResponse` strips `opendesignControlKey` in the three provider routes. Vietnamese usage strings translated (upstream `c0feb3a0`). Pricing and caps rows per the owner rule (see Model tracking) |
| 3 | `dbe446d0` | Alibaba Token Plan dual endpoint + usage accounting | keep, adapted | `alitp-intl` claude/openai transports, ten new ids, capability rows, `mergeUsage` cache fix, `formatDoneLine` canonical usage. **Dropped:** the new `qwencloud` provider (not in this fork, not needed by the `alitp-intl` change) |
| 4 | `fdd942de` | token-saver REA allow toggle | keep, adapted | LiteRouter has no `translator/concerns/systemPrompt.js`; the module sits with the other system-prompt injectors as `open-sse/rtk/reaAllow.js`. Setting, chat wiring and Token Saver toggle ported |
| 5 | `c0feb3a0` | translate leftover Vietnamese | keep, partial | only strings that exist here: qoder `authHint`, an `injectDisplayToRegistry` log line, opencode Free 1.3 test titles, OpenDesign usage strings. Comment translations have nothing to land on |
| 6 | `e180e752` | bump next toolchain, node-forge, vitest | drop | Next/Node/vitest deps; this repo is Bun-only |
| 7 | `374e17b8` | Codex GPT 6.2 Sol and Astra | keep, adapted | plain ids only (no `responsesLite`/`thinkingLevels`/`[1m]` shapes in LiteRouter's codex registry); Astra gets the Codex 272k window |
| 8 | `c779db2b` | OpenClaw prompt header + Antigravity live catalog | keep | cherry-pick; `kenari` kept in the live-catalog set |
| 9 | `bb399170` | strip Hermes lines that trigger fake 429 | keep | cherry-pick |
| 10 | `ef55a10c` | Qoder image uploads sign multipart length | keep, adapted | `computeCosySignature` + `signatureBody` option; upstream's `deriveMachineId` context is not in this fork |
| 11 | `ba3bba47` | NVIDIA Nemotron 3 Ultra tools + 1M | keep | cherry-pick |
| 12 | `bf5c4192` | validate x-opencode-session for opencode-go | keep, adapted | session id from `Bun.CryptoHasher`, no comment |
| 13 | `46f488b1` | Cloudflare Clef/Clef Omni/Clairic + custom upstreamModelId | keep, adapted | ported into `src/sse/handlers/systemOne.js` (no `systemoneCore.js` here). **Not applicable:** custom-model `upstreamModelId`. LiteRouter's System One route only serves registry models on registered providers, and its custom-model repo/API has no such field |
| 14 | `05fa58b8` | Antigravity Hub 2.33.0 fingerprint | keep, adapted | LiteRouter still sent `antigravity/ide/2.11.0` (the earlier `f172c3c4` Hub switch was dropped with the MITM runtime); now `antigravity/hub/2.33.0 darwin/arm64` from `providers/shared.js`. MITM file not taken |
| 15 | `e37cb78e` | official Antigravity identity prompt | keep | cherry-pick; `upstream-intake-retained-core` asserts the rewritten Hermes text on the last system part |
| 16 | `971ae638` | billing header out of cached Claude system prompt | keep | `stripAnthropicBillingHeader` moves to `concerns/message.js` |
| 17 | `a851a89c` | NVIDIA live embedding models + input_type | drop | no embeddings core here (`open-sse/handlers` holds only chatCore) |
| 18 | `0957919c` | Kiro CreateResponse fallback on 429 | keep, adapted | env is `LITEROUTER_KIRO_CREATE_RESPONSE` (or `KIRO_CREATE_RESPONSE`), in `.env.example`; region allowlist alone (no `awsConstants.js` here); spies restored |
| 19 | `7d32657c` | Kimi K3.1 Code limits | keep, adapted | `kimi-k3.1-pro` caps row added too; pricing rows; localDb mock spreads `?actual` |
| 20 | `72ad720c` | ElevenLabs TTS refresh | drop | no TTS core here |
| 21 | `213558f1` | Mistral text_delta + Large 4 limits | keep | conflict resolution only |
| 22 | `6e3c16a1` | billion/trillion token formatting | keep, adapted | `fmtCompactTokens` in `tokenDisplay.js` backs the redesigned `UsageChart` (keeps its `.0` trim); no ProviderBarChart/TopModelsChart here |
| 23 | `4e548583` | combo seat context limits + OpenCode free windows | keep, adapted | seat `(level)` strip in LiteRouter's nested-combo resolver; the OpenCode live resolver is bounded and cached (`open-sse/services/opencodeFreeModels.js`), skips under `skipDynamicFetch` and merges the static rows back so `union-alpha` stays listed |
| 24 | `f5f3d396` | proxy-pools Cloudflare worker upload | drop | checked: LiteRouter's `src/app/api/proxy-pools` has only `netlify-deploy`, no `cloudflare-deploy` route or `cloudflare-worker-upload` lib to fix |
| 25 | `1ca07616` | Pi CLI-tools config | drop | CLI-tools surface deleted in `601667ec` (minimal profile) |
| 26 | `35b920c6` | unwrap Cloudflare result envelope | keep, adapted | with #13 in one commit |
| 27 | `ecb4d49e` | Cloudflare AI prune + replacements | keep, adapted | chat models only (no image handler, so no image rows); `serviceKinds` stays `["llm","systemone"]` |
| 28 | `ada236da` | Kiro IDE 1.4.154 identity + Gemini 4 Hydrogen tiers | keep, adapted | Kiro identity as written; Hydrogen Antigravity tiers, usage list, xhigh levels, Hydrogen caps and pricing patterns. Not taken: request-body tier resolver in `getModelUpstreamId`, generic `*gemini-4*` level row, quota-family helpers (they build on upstream commits this fork never carried). Upstream Hydrogen test replaced by one covering what landed |
| 29 | `109e4816` | Hydrogen long decode + prompt-rejection recovery | **deferred** | see Deferred |
| 30 | `bc3a88b9` | align Hydrogen test expectations | **deferred** | only adjusts the tests of #29 |
| 31 | `767d7aeb` | correct Gemini 4 / Claude 5.5 ids and tiers | keep, partial | bare Carbon and Hydrogen default to high; Hydrogen xhigh already in via #28. The rest is deferred (see Deferred) |
| 32 | `9fb84c94` | CLI-tools pickers | drop | CLI-tools surface deleted (minimal profile) |
| 33 | `1da78e2b` | Kiro identity on token refresh | keep | cherry-pick; CHANGELOG hunk not taken |
| 34 | `6b8b7ceb` | Antigravity identity alignment + UA shape | keep, partial | `Accept: text/event-stream` on streaming calls; version/UA already in via #14. The MITM UA rewrite and its parity test have no module here |
| 35 | `5ae63d22` | v0.5.123 | drop | upstream release marker |

## Deferred

- **`109e4816` (and its test follow-up `bc3a88b9`).** The Gemini long-decode loop (`utils/geminiLongDecode.js`, CONTINUATION hops past 64K output) and the prompt-rejection recovery (retry with the system text moved into the first user turn, classify the bare 429 as a request-scoped 400) hang off upstream executor code LiteRouter does not have: `AntigravityExecutor.execute`/`parseError` overrides with quota-reset parsing, `readBodyOnce`, `isAntigravityPromptRejection`, `isImageModel`, the DNS-bypass error path, and a `DefaultExecutor.execute` override next to Nous attribution. Carrying it means porting that base first; a half port would change retry and account-lock behaviour on every Antigravity 429. Already carried from it: the Hydrogen pricing pattern and the gemini registry row (LiteRouter had it).
- **The rest of `767d7aeb`.** It corrects rows LiteRouter's Antigravity catalog never took: Gemini 4 Argon tiers and the bare Argon alias, the new Gemini 4 Neon family (xhigh), Claude Sonnet/Opus 5.5 max tiers and the medium default, their thinking-level rows, quota slots, MITM slots and CLI menus. Adding them is catalog expansion (the earlier `f172c3c4` was dropped for the same reason) and needs pricing/caps rows; it waits for an owner call.

## Added by LiteRouter (not upstream)

- `src/lib/providerConnectionResponse.js` + `tests/unit/provider-connection-response.test.js`: one helper for the provider API responses so the OpenDesign control key never leaves the server.
- `open-sse/services/opencodeFreeModels.js` + `tests/unit/opencode-free-models.test.js`: bounded, cached OpenCode free-catalog fetch shared by `/v1/models` and the suggested-models filter.
- `tests/unit/provider-pricing-gateways.test.js`: owner-rule pricing/caps coverage for OpenDesign Go, DeepRelay, Token Plan and Kimi K3.1.
- Cloudflare System One regression tests in `tests/unit/systemone.test.js` (selector, shape validation, custom node, envelope unwrap with usage, untouched bodies, pricing) and Workers AI pricing/window rows in `tests/unit/cloudflare-ai-registry.test.js`.
- Baseline refresh: `providers-baseline.json` and `alias-baseline.json`.

## Model tracking

Every model this intake introduces or exposes. Pricing rows live in `open-sse/providers/pricing.js` (USD per 1M tokens: input / output / cache read / cache write), capability rows in `open-sse/providers/capabilities.js`. "Explicit zero" rows mean the vendor publishes no per-token rate, not that the model is free: **TODO** revisit when the vendor publishes one.

| model id | provider | pricing source | caps source |
| --- | --- | --- | --- |
| 33 seeded ids (`deepseek-v4.1-flash` ... `grok-4.5`) | opendesign-go | go.open-design.ai/models (per-model catalog): first input-length tier for the GPT 6.x/5.6 rows (≤272K) and Claude Haiku 5.5 (≤100K); cache write only where listed. e.g. `claude-opus-5.5` $4 / $20 / $0.20 / $5 | vendor publishes no context/output limits: rows copy the model-family capability row (Claude dotted ids use the dashed family); `hy4-preview` has no family, so it carries the default limits |
| 17 seeded ids (`deepseek-v4.1-flash` ... `gpt-oss-120b`) | deeprelay | api.deeprelay.ai/v1/models (public JSON, `*_per_1m_tokens_cents`), DeepSeek V4.1 Flash at its peak rate ($0.135 / $0.54 / $0.0027); no cache write published | same feed's context length and max output (1M / 393K for DeepSeek, 1M / 131K for Kimi/GLM, ...), modality flags from the family row |
| `qwen4-max`, `qwen4-max-preview`, `qwen3.8-max`, `qwen3.8-flash`, `deepseek-v4-pro-0813`, `auto` | alitp-intl | **explicit zero + TODO**: Token Plan bills credits, no per-token rate published | upstream rows (1M; 393K or 131K output); `auto` default limits |
| `glm-5.3`, `deepseek-v4-flash-0731`, `deepseek-v4.1-flash`, `deepseek-v4.1-flash-1017` | alitp-intl | family rows already in `MODEL_PRICING`/patterns (list price; Token Plan credit rate unpublished) | family rows |
| `gpt-6.2-sol`, `gpt-6.2-astra` | codex | already priced (`MODEL_PRICING`, $2/$10/$0.10 and $8/$40/$0.40) | `MODEL_CAPABILITIES`; Astra gets a Codex 272k row |
| `k3.1-pro` | kimi | $2 / $10 / $0.20: the K3.1 Pro rate synthetic.new and DeepRelay both list for this model (Moonshot's own Code-plan rate not published) | upstream row (1,048,576 / 131,072, kimi thinking, vision/video) |
| `k3.1-pro-highspeed` | kimi | **explicit zero + TODO** (no rate published) | same |
| `gemini-4-hydrogen-{xhigh,high,medium,low}`, `gemini-4-hydrogen` | antigravity | `gemini-4-hydrogen*` pattern $1.50 / $7.50 / $0.075 (upstream 109e4816; matches the existing `gemini-4-hydrogen` row) | `*gemini-4-hydrogen*` pattern (1,048,576 / 65,536, pdf/audio/video, gemini-level, xhigh) |
| `@cf/meta/llama-4-scout-17b-16e-instruct`, `@cf/deepseek-ai/deepseek-v4.1-flash-1017`, `@cf/google/gemma-4-26b-a4b-it`, `@cf/zai-org/glm-5.3`, `@cf/openai/gpt-oss-120b`, `@cf/openai/gpt-oss-20b`, `@cf/qwen/qwen3.8-27b` | cloudflare-ai | developers.cloudflare.com/workers-ai/platform/pricing and each model page (e.g. Llama 4 Scout $0.27 / $0.85; qwen3.8-27b cache read $0.05 is on the model page only) | the model pages' context windows (131K, 1M, 256K, 1M, 128K, 128K, 262K) |
| `@cf/cloudflare/clef-omni`, `@cf/cloudflare/clairic` | cloudflare-ai (System One) | same pages: $0.15 and $0.24 per 1M input, no output charge (Clairic's $0.10 promo ends 2026-12-01, so the list price is used) | model pages (64K / 65,536) |
| `@cf/cloudflare/clef`, `@cf/cloudflare/clef-flash` | cloudflare-ai (System One) | existing rows; Clef Flash corrected $0.09 → $0.038 per the pricing page | model pages (65,536 / 24,576) |
| `longcat-2.5-free`, `iceman-free`, `inkling-2-small-free`, `beam-free`, `flint-40b-free`, `nemotron-3.5-super-vl-free`, `jev-1.13-free`, `nemotron-3.5-lightning-free`, `hy4-flash-free`, `tidepool-alpha-free` | opencode | $0 (OpenCode Zen free lane) | upstream rows from the live catalog windows |
| any other id from the OpenCode live free catalog | opencode | none; `noteUntrackedModel` warns once | live catalog `limit.context`/`limit.output` |
| `mistral-large-latest`, `mistral-large-4`, `mistral-large-4-0` | mistral | unchanged (not new ids) | native-provider rows, 1,048,576 |
| `nvidia/nemotron-3-ultra-550b-a55b` | nvidia | unchanged | tools true, 1,000,000 |

## Risk

- **Antigravity identity change.** The UA moves from `antigravity/ide/2.11.0` to `antigravity/hub/2.33.0`, and every generation request now opens with the official identity block. Both match upstream's live client, but an account that only worked with the old identity would now see different upstream behaviour.
- **Kiro identity change.** Every Kiro call now sends the IDE 1.4.154 UA; the old one is being rejected upstream, so this is a fix, but it changes headers on every Kiro request. The CreateResponse fallback adds one replay (plus one 1.5 s retry) after a 429 `USER_REQUEST_RATE_EXCEEDED`.
- **`/v1/models` reaches opencode.ai** when an OpenCode connection (or the no-auth free lane) is listed and `skipDynamicFetch` is off: at most once per 10 min per process, 5 s cap, failure falls back to the static rows.
- **Gateway pricing is a snapshot.** OpenDesign Go and DeepRelay rates were read on 2026-11-24; tiered (input-length) rates bill at the first tier, and DeepSeek V4.1 Flash on DeepRelay at its peak rate, so long prompts and off-peak traffic are slightly mis-estimated.
- **Explicit zero rows understate spend** for the Token Plan ids and `k3.1-pro-highspeed` until rates are published.
- **REA allow** is off by default. When on, it removes the client's security-policy paragraph from the system prompt of every request; the replacement still asks the model to refuse unlawful or unauthorized use.
- Rollback: revert the merge. No schema, migration or deploy change; one new optional env var (`LITEROUTER_KIRO_CREATE_RESPONSE`).

## Open questions for the owner

1. Take the rest of `767d7aeb` (Antigravity Gemini 4 Argon/Neon tiers, Claude 5.5 tiers) as a catalog expansion?
2. Port the base Antigravity executor pieces so `109e4816` (long decode, prompt-rejection recovery) can follow?
3. Should Alibaba Token Plan and `k3.1-pro-highspeed` bill at a list-price proxy instead of an explicit zero?
