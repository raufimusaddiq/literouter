# ADR-0050: Provider quirks: Cline, Kimi, Trae, Kimchi and System One

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Several providers deviate from plain OpenAI-compatible behavior: Cline wraps non-stream bodies in an envelope and uses WorkOS JWTs, Kimi has dual auth and device ids, Trae uses a multi-step remote agent protocol, Kimchi validates reasoning content, and System One passes a restricted set of headers with custom transports. Each quirk is contained in the provider's registry entry, executor or opt-in flag so other providers are never rewritten. This ADR collects those provider-specific decisions.

## Decisions

### D1. Cline envelope unwrap is opt-in per provider

Cline (and ClinePass, and Cline free models like z-ai/glm-5.3-flash and deepseek-v4-flash) return non-stream chat completions as `{"success":true,"data":{...choices...}}`. Readers expect `choices` at the top level, so enveloped bodies were invisible ("Provider returned no completion choices for this model"). The unwrap runs before any consumer reads choices or usage, so non-stream clients get a bare OpenAI body and usage tracking sees `data.usage`. It applies only to providers that opt in through `transport.quirks.clineEnvelope`, so it can never rewrite another provider's body, including one that returns `{"success":true,"data":...}` for its own reasons. The error envelope (`success:false`) never matches and passes through. Both the proxy non-stream path and the UI model-test ping unwrap.

**Where:** `open-sse/shared/clineEnvelope.js`; `open-sse/handlers/chatCore/nonStreamingHandler.js`; `src/app/api/models/test/ping.js`; `open-sse/providers/registry/cline.js`; `open-sse/providers/registry/clinepass.js`; `tests/unit/cline-free-models-envelope.test.js`

### D2. Cline OAuth tokens get the `workos:` prefix; ClinePass keys are sent verbatim

Cline OAuth access tokens are WorkOS JWTs (base64url `eyJ...`). ClinePass API keys (category "apikey", `clp_...`) are opaque, not JWTs, and prefixing them with `workos:` makes the Cline API reject the request with HTTP 401. ClinePass uses a plain API key from app.cline.bot/settings/api-keys; the OAuth extension flow used by Cline does not issue tokens the ClinePass consumer endpoint accepts (HTTP 401, #2333). Model listing for Cline and ClinePass shares `api.cline.bot/api/v1/models`; Cline returns the whole catalog verbatim and ClinePass keeps `cline-pass/*` only.

**Where:** `open-sse/shared/clineAuth.js`; `open-sse/providers/registry/clinepass.js`; `src/app/api/providers/[id]/models/route.js`; `tests/unit/cline-auth.test.js`

### D3. Kimi is dual-auth with a stable per-connection device id

Kimi uses dual auth with the same pattern as xai: OAuth for Kimi Code subscriptions (device code) and API keys for platform.moonshot / api.kimi.com, sharing one transport (CLIProxyAPI parity: client_id, auth.kimi.com device and token endpoints, `X-Msh-*` headers). `deviceId` must stay stable per connection for the whole OAuth session. Kimi Code natively serves the OpenAI Responses API (Codex `wire_api = "responses"`), the refresh threshold is 300 seconds, and API-key connections also hit `/v1/usages` (x-api-key), so they need `usageApikey` for `isUsageEligible` and `/api/usage` to allow non-oauth authType. A legacy id and short alias are kept from the former kimi-coding entry, and K3 uses ids `kimi-k3` (platform) and `k3` (Kimi Code OAuth).

**Where:** `open-sse/providers/registry/kimi.js`; `open-sse/config/appConstants.js`

### D4. Trae SOLO uses a two-step remote agent flow

Chat is POST `{base}/chat_sessions` (returns `chat_session_id` and `message_id`), then GET `{base}/chat_sessions/{id}/events?reply_to_message_id=...` as SSE. Assistant text streams in `plan_item` events under `thought` (cumulative per plan-item id), `token_usage` carries usage, `done` ends the turn and `error` carries upstream errors. Auth is the `Authorization: Cloud-IDE-JWT <jwt>` scheme (RS256, about 14-day lifetime), injected by the executor's `buildHeaders`; identity fields for `common_params` live in `providerSpecificData`. Trae expects the query as a JSON-encoded string of typed content blocks.

**Where:** `open-sse/executors/trae.js`; `open-sse/providers/registry/trae.js`

### D5. Kimchi strips only real client reasoning_content

Clients echo `reasoning_content` on assistant messages. The Kimchi executor strips it only when it is a real thinking block, because `DefaultExecutor.transformRequest` runs `injectReasoningContent` first and may inject a one-character placeholder (" ") for upstream validation. Stripping the placeholder would re-trigger the upstream complaint about missing reasoning on the next turn; the threshold matches the placeholder length with a safety margin.

**Where:** `open-sse/executors/kimchi.js`

### D6. System One forwards only allowed headers and resolves custom nodes asynchronously

Only specific client headers reach the provider (TypeSafe's danger-zone headers switch on image assets and long context; nothing else is forwarded), and hop-by-hop or body-affecting headers are never forwarded. Custom nodes with prefix `systemone-<uuid>` are async, resolved in `handleSystemOne`, where a cache-hit lookup is one await like `getSettings`. Cloudflare Workers AI wraps System One payloads in `{ result: {...}, success }`. Built-in dual-transport providers (for example Cloudflare Clef) keep chat and System One endpoints separate; System One URLs may reference `{accountId}` (connection `providerSpecificData`) and `{model}`. The dashboard lab generates ids with a random per-page-load token so ids restored from localStorage never collide after the counter restarts, and saves only after the loaded form is committed so strict-mode double effects do not overwrite storage with a blank form.

**Where:** `src/sse/handlers/systemOne.js`; `src/app/(dashboard)/dashboard/systemone/lib/requestBuilder.js`; `src/app/(dashboard)/dashboard/systemone/page.js`

## Consequences

- Applying the Cline unwrap globally could rewrite other providers' bodies; omitting it makes Cline completions look empty.
- Prefixing ClinePass keys with `workos:` returns 401.
- Changing the Kimi device id mid-session invalidates the OAuth session.
- Stripping Kimchi placeholders makes the upstream reject the next turn.
- Forwarding arbitrary headers to System One can change upstream behavior or break bodies.
