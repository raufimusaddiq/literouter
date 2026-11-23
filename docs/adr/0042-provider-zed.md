# ADR-0042: Zed executor and auth

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Zed's hosted LLM aggregator (`cloud.zed.dev/completions`) is a multi-format proxy that fronts Anthropic, OpenAI, Google and xAI models depending on the model. Its auth is not standard OAuth (see ADR-0028 for the login flow), and its wire protocol does not fit the generic executor contract. The pieces are `ZedExecutor` (`open-sse/executors/zed.js`), the provider registry entry, `open-sse/shared/zedAuth.js`, and the models route. The reasons behind the shape of this integration are not visible from the code alone, and a few upstream quirks fail with misleading errors.

## Decisions

### D1. `ZedExecutor` overrides `execute()` entirely instead of using the DefaultExecutor pipeline

The wire shape is a thread envelope, a short-lived LLM bearer token exchanged from the RSA-decrypted `access_token`, and an NDJSON/SSE-ish response made of one body per line (`{"event": <provider-shaped chunk>}`, `{"status": ...}`, `[DONE]`). That does not fit the generic `transformRequest` / `buildUrl` contract. The provider-shaped chunk is Claude, Gemini, OpenAI-Responses or xAI (OpenAI-shaped) depending on which upstream Zed fronts for the model, and it is translated back to OpenAI Chat Completions by reusing the existing translators.

**Where:** `open-sse/executors/zed.js`: `ZedExecutor.execute`, `wrapZedCompletionStream`, `convertProviderEvent`

### D2. The `provider` field must use Zed's exact wire values

The `provider` field of `POST /completions` takes Zed's catalog spellings (`anthropic`, `open_ai` with an underscore, `google`, and `x_ai` following the same convention), not display names. `cloud.zed.dev` matches them exactly, and an unrecognized value fails the whole request with `500 {"message":"An internal server error occurred."}` before the model is even looked at. Spellings come from Zed's own `GET /models` catalog, so feeding a catalog value back through `normalizeZedProvider` is the identity.

**Where:** `open-sse/executors/zed.js`: `ZED_PROVIDER`, `normalizeZedProvider`; `tests/unit/zed-completions-wire.test.js`

### D3. `is_error` is a required bool on Anthropic tool_result for Zed

`cloud.zed.dev` parses `provider_request` with Zed's Anthropic types, where `ToolResult.is_error` is a required bool. Omitting it makes the request fail, so the Claude translation always emits it (see ADR-0020). It is safe for every Claude target, since Anthropic treats it as optional and defaults to false.

**Where:** `tests/unit/zed-completions-wire.test.js`; `open-sse/translator/request/openai-to-claude.js`: `resolveToolResultIsError`

### D4. Client-side `safetySettings` are dropped for the Zed Google path

Zed's hosted Gemini backend speaks the Vertex safety vocabulary, not the public Gemini API enum that the shared translator emits (`OFF`, `CIVIC_INTEGRITY`, `DANGEROUS_CONTENT`). Client `safetySettings` are removed on this path so Zed applies its own defaults. The change is scoped to the Zed executor so native Gemini and Antigravity are untouched.

**Where:** `open-sse/executors/zed.js`: `buildProviderRequest` (Gemini branch)

### D5. Auth is non-standard and the model catalog is live, not hardcoded

The auth scheme is `Authorization: <user_id> <access_token>` plus a duplicate `x-zed-cloud-token` header (verified against zed_account.rs `build_authorization_header` and the cloud fetch). The executor builds both, and the scheme in the registry is only a marker for config-driven tooling. The credential is a per-login keypair with no client id, client secret, token URL or refresh URL, and the access token is long-lived with no refresh. Zed's hosted model list changes frequently and fronts a rotating set of upstream models (Claude, GPT, Gemini, Grok), so the registry has an empty static catalog with passthrough, and any client-sent model id is forwarded as-is rather than validated against a frozen list. The catalog is fetched live per connection through `modelsUrl` and cached by `zedAuth`. The models route resolves it with the connection's own credentials, which are never exposed to the browser. It returns rich metadata with disabled entries dropped, and an empty or failed result yields an explicit warning and never a silent zero list. The `systemId` from the login attempt is merged into `meta` at exchange so the stored connection keeps the id sent to zed.dev.

**Where:** `open-sse/providers/registry/zed.js`; `open-sse/shared/zedAuth.js`: live catalog resolver, token exchange; `src/app/api/providers/[id]/models/route.js`: Zed branch; `src/app/api/oauth/[provider]/[action]/route.js`: exchange (`systemId`)

## Consequences

- Routing Zed through the generic executor breaks the thread envelope, token exchange and status-frame handling.
- A display-name `provider` value returns an opaque 500 that looks like a server outage.
- Omitting `is_error` or forwarding public-API `safetySettings` makes Zed reject otherwise valid requests.
- Freezing the Zed catalog in the registry hides new models and breaks passthrough to ones that rotate in.
