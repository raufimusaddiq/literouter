# ADR-0044: Xiaomi MiMo provider (dual auth, Preview models, free lane)

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Xiaomi MiMo has two surfaces. The cloud API at `api.xiaomimimo.com` accepts an `sk-` API key. MiMo Desktop adds Desktop-exclusive Preview models served by the account-service route on `mimo-server-cn.xiaomimimo.com`, authorized by a Xiaomi account session instead of the key. A separate free "MiMo Code" chat endpoint has its own anti-abuse gates. The OAuth flow is non-standard (ECDH-encrypted callback). The same session handshake also powers the weekly quota (see ADR-0023).

## Decisions

### D1. Dual auth with the endpoint chosen per model in the executor

Like kimi, the provider accepts an API key (cloud API) or a Desktop account/OAuth connection (same cloud host plus Preview models via the account route). Preview models are resolved in `buildUrl` before the default `runtimeTransport` path because the account route is not one of the declared transports. The route only accepts OpenAI format, so `supportedFormats` pins Preview models to the openai transport. `xiaomi-tokenplan` omits `baseUrl` because it is region-dynamic, resolved in the executor's `buildUrl`.

**Where:** `open-sse/executors/xiaomi-mimo.js`: `buildUrl`, `PREVIEW_MODELS`; `open-sse/providers/registry/xiaomi-mimo.js`; `open-sse/providers/registry/xiaomi-tokenplan.js`

### D2. The session cookie is resolved in async execute() and read in sync buildHeaders()

Preview models are authorized by the account-session cookie (not the `sk-` key; handshake in `shared/mimoAccount.js`). `BaseExecutor.execute` does not await `buildHeaders`, so the cookie is resolved in `execute()` and carried on the per-request credentials object (same as `runtimeTransport`) under `COOKIE_KEY`, then read back synchronously. For Preview models, thinking and params receive defaults only and never override what the caller set explicitly; `super.transformRequest` runs `stripUnsupportedParams`, which flattens Preview content-part arrays per the xiaomi-mimo rule in `translator/concerns/paramSupport.js`.

**Where:** `open-sse/executors/xiaomi-mimo.js`: `execute`, `buildHeaders`, `transformRequest`

### D3. The Desktop passToken is persisted per connection

The account-session `passToken` lives only in MiMo Desktop's cookie store. It is attached to the connection after OAuth and during auto-import so Preview models work immediately and multiple Xiaomi accounts rotate independently. It is null while Desktop is running because its cookie DB is exclusively locked.

**Where:** `src/app/api/oauth/[provider]/[action]/route.js`: `POST` (xiaomi-mimo branch); `src/app/api/oauth/xiaomi-mimo/auto-import/route.js`: `GET`

### D4. OAuth uses a custom ECDH callback with a strict session lifecycle

The callback carries `?u=<ECDH-encrypted payload>` instead of `?code=`; decryption yields `{ uid, sk, url }` and is handled by the Xiaomi MiMo OAuth service, not the generic PKCE pipeline. Each `/authorize` registers a session holding an X25519 private key keyed by a fresh state. Because this is a Map (unlike the singleton sessions of trae/windsurf/zed), it must be cleared when the callback listener goes down or every login would leak a private key for the process lifetime. A finished session must survive `/poll-status` until `/exchange` consumes it (clearing in poll-status made the following POST /exchange see a missing session and return 400, killing the browser-OAuth fallback); a failed session is cleaned up by `/poll-status` itself.

**Where:** `open-sse/providers/registry/xiaomi-mimo.js`; `tests/unit/xiaomi-mimo-oauth-proxy.test.js`; `tests/unit/xiaomi-mimo-oauth-session.test.js`

### D5. API-key import soft-fails on validation

If validation cannot reach the network, or fails, the key is still stored but marked untested (a key may be valid while the network is blocked). Duplicate connections for the same uid or key are updated rather than duplicated.

**Where:** `src/app/api/oauth/xiaomi-mimo/api-key/route.js`: `POST`

### D6. The free chat endpoint needs a Chrome User-Agent and a MiMoCode system marker

The free endpoint's anti-abuse gate returns 403 "Illegal access" (surfacing as 502 "MiMo bootstrap failed: 403", issue #1933) unless the request has a Chrome-like User-Agent and a system message containing the exact MiMoCode signature substring (`MIMO_SYSTEM_MARKER`).

**Where:** `open-sse/executors/mimo-free.js`: `USER_AGENTS`, `MIMO_SYSTEM_MARKER`; `tests/unit/mimo-free.live.test.js`

## Consequences

- Reading the cookie in `buildHeaders` without resolving it in `execute` sends Preview requests unauthenticated.
- Authenticating Preview models with the `sk-` key fails; they are not reachable by key.
- Clearing OAuth sessions in `poll-status` breaks the exchange step; never clearing them leaks X25519 private keys.
- Dropping the UA or system marker on the free lane produces 403 / 502 errors.
