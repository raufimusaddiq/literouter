# ADR-0051: Provider quirks: OpenAI-compatible providers

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Most providers go through `DefaultExecutor` and the registry (`open-sse/providers/registry/*`), with deviations expressed as `quirks` on the provider config or as per-model fields. Several "OpenAI-compatible" upstreams reject fields that the real OpenAI API accepts, serve different key types on different hosts, or answer 200 for any API key. These quirks are discovered from live failures, and the code looks like arbitrary special-casing unless the failure is known. This ADR records the observed upstream behaviour for DeepSeek, Kenari, the Alibaba and SenseNova families, NVIDIA NIM, Cloudflare Workers AI and the Kiro body.

## Decisions

### D1. Kenari's `/v1/models` is auth-blind, so key validation uses the quota endpoint

Kenari's `/v1/models` answers 200 for any key (verified against the live endpoint with a garbage key), so probing `transport.validateUrl` would report a revoked key as valid. The connection test and the provider-validate route probe `/v2/quotas`, which is also what `getKenariUsage` already trusts for auth and which answers 401 "invalid key". This case was added to `testApiKeyConnection` because Kenari is a first-class registry provider (category `apikey`, with `transport.validateUrl` and `transport.usage.url` declared) and previously fell through to `default:` with "Provider test not supported". The models route serves Kenari's daily-synced list from cache only, resolving `caps` and `thinkingLevels` server-side because the browser has no catalog source installed, and falls back to the static list when the cache is empty.

**Where:** `src/app/api/providers/[id]/test/testUtils.js`: `testApiKeyConnection` (Kenari case); `src/app/api/providers/validate/route.js`: Kenari branch; `src/app/api/providers/[id]/models/route.js`: Kenari branch; `tests/unit/kenari-connection-test.test.js`

### D2. Kenari's Responses endpoint accepts a subset, and bodies must be well-formed JSON

`/v1/responses` honors only flat `function` tools and rejects `text.format` structured outputs, so Codex's `custom` exec tool is converted and `text.format` stripped, which lets Codex keep its native custom-tool wire events. It also rejects `role: "system"`, so instructions are folded into the first user turn before dispatch (`responsesSystemRoleUnsupported` quirk). Kenari answered 400 "invalid JSON: lone leading surrogate in hex escape" for bodies holding a split emoji, so the gateway serializes with `stringifyWellFormed` and sends U+FFFD instead of a bare `\udXXX` escape. See ADR-0011 for the chatCore side of the conversion.

**Where:** `open-sse/providers/registry/kenari.js`: quirks; `open-sse/executors/default.js`: `DefaultExecutor.transformRequest`; `open-sse/executors/base.js`: body serialization; `open-sse/utils/wellFormedJson.js`: `stringifyWellFormed`; `tests/unit/well-formed-json.test.js`

### D3. Alibaba and SenseNova key types are per-host, so each type is its own provider

Alibaba key types are not interchangeable across hosts. `alicode-intl` takes Coding Plan keys (`sk-sp-...`, `coding-intl.dashscope.aliyuncs.com`, #2591). `alims-intl` takes standard DashScope keys (`sk-...`, `dashscope-intl.aliyuncs.com/compatible-mode`). `alitp-intl` takes Token Plan credit-subscription keys on `token-plan.<region>.maas.aliyuncs.com`, and each of these hosts rejects the other types' keys. Token Plan is served only in Singapore (`eu-central-1` answers `IllegalEndpoint`), and its Anthropic surface (`/apps/anthropic/v1/messages`) is not authorized, so OpenAI-compatible mode is the only transport. DashScope supports explicit `cache_control: { type: "ephemeral" }` in content blocks, but the default `filterToOpenAIFormat` strips them, so the `preserveCacheControl` quirk opts in for alicode and alicode-intl (#2069). SenseNova international (`platform.sensenova.ai`) uses the same OpenAI-compatible wire as the China site but keys are per site, and `token.sensenova.cn` rejects international keys with 401 "Forbidden", so it is a separate provider (the same split as alicode/alicode-intl). LiteRouter has no image-generation handler, so only the chat catalog is registered and the vendor's u1.x image models are not advertised.

**Where:** `open-sse/providers/registry/alims-intl.js`; `open-sse/providers/registry/alitp-intl.js`; `open-sse/providers/registry/sensenova-intl.js`; `tests/unit/alicode-intl-endpoint-2591.test.js`; `tests/unit/alicode-cache-control-2069.test.js`; `tests/unit/alibaba-token-plan-provider.test.js`; `tests/unit/sensenova-intl-provider.test.js`

### D4. DeepSeek: whitelisted tool types, and the catalog id differs from the upstream id

DeepSeek's Anthropic-compatible endpoint (`https://api.deepseek.com/anthropic/v1/messages`) accepts only the built-in `web_search_*` tools. It rejects client-defined `custom` tools with 400 "unknown variant `custom`, expected `web_search_20250305` or `web_search_20260209`". The provider declares `claudeSupportedToolTypes`, so `prepareClaudeRequest` forwards only `web_search_*` tools and MCP or function tools are dropped instead of failing the whole request (see ADR-0020). The OpenAI-compatible transport is unaffected. DeepSeek also renamed the served id: the API only accepts `deepseek-flash` and `deepseek-v4-pro`, and rejects `deepseek-v4.1-flash` with 400 (#4940). The catalog id stays `deepseek-v4.1-flash` because clients ask for it, but the request leaving the gateway must carry the upstream name via `upstreamModelId`.

**Where:** `open-sse/providers/registry/deepseek.js`: `quirks.claudeSupportedToolTypes`, model entries with `upstreamModelId`; `tests/unit/deepseek-v41-flash-upstream-id.test.js`

### D5. `stream_options` is stripped from non-streaming requests

OpenAI-compatible upstreams (NVIDIA NIM, DeepSeek) reject `stream_options` on non-streaming requests with 400 "Stream options can only be defined when stream=True". `DefaultExecutor.transformRequest` copies the body and deletes it when not streaming. This also applies to Fusion combo panel requests running non-streaming (#3024). Separately, some OpenAI-compatible providers reject Anthropic's `client_metadata` field, so a `dropClientMetadata` quirk removes it.

**Where:** `open-sse/executors/default.js`: `DefaultExecutor.transformRequest`; `tests/unit/fusion-strip-stream-options-3024.test.js`

### D6. Kiro request bodies must not carry a top-level `systemPrompt`

The kiro.dev gateway answers any body carrying `systemPrompt` with 400 `REQUEST_BODY_INVALID`. The translator stopped emitting it in v0.5.59, but the RTK system injector kept adding it back, so every `kr/` model failed while an RTK prompt was active. The injector now gates on turn shape and never writes the field (see ADR-0030).

**Where:** `open-sse/rtk/systemInject.js`: Kiro shape detection and injection

### D7. Cloudflare Workers AI wraps responses in `{ result, success }`

Cloudflare Workers AI wraps System One responses in a `{ result, success }` envelope, which the registry entry accounts for.

**Where:** `open-sse/providers/registry/cloudflare-ai.js`

## Consequences

- Validating Kenari keys against `/v1/models` makes revoked keys look valid.
- Merging the Alibaba or SenseNova key types into one provider sends keys to hosts that reject them (401 or `IllegalEndpoint`).
- Forwarding `stream_options` on non-stream requests, or the catalog id `deepseek-v4.1-flash` upstream, produces 400s from NIM and DeepSeek.
- Letting `custom` tools reach DeepSeek's Anthropic endpoint, or adding `systemPrompt` to Kiro bodies, fails every request on those routes.
- Dropping well-formed JSON serialization breaks requests containing split emoji on Kenari.
