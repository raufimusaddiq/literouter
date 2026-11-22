# ADR-0028: OAuth flows for custom providers

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Several providers do not use a standard registered-client OAuth2/PKCE flow. Zed uses an RSA keypair and Xiaomi MiMo an X25519/ECDH encrypted callback. Trae and Windsurf run a local-callback flow with provider-specific steps, and Qoder runs a custom device flow. Kiro, Kimi, CodeBuddy and Grok CLI each have their own quirks. The definitions are in `src/lib/oauth/providers/*`, `src/lib/oauth/services/*`, `src/lib/oauth/constants/oauth.js` and the `[provider]/[action]` API route. This ADR records the per-provider facts that are not obvious from the code and that cost real debugging to learn.

## Decisions

### D1. Zed uses an RSA keypair, not OAuth, and the login attempt's `system_id` and port must be reused

Zed's cloud (`cloud.zed.dev`) authenticates native apps with a per-login RSA-2048 keypair instead of a registered client id and secret. The client generates the keypair (the private key rides in the OAuth `codeVerifier` slot, encoded as a PEM-derived opaque verifier), binds a local loopback port, and opens `zed.dev/native_app_signin?native_app_port=...&native_app_public_key=...`. The browser redirects to `http://127.0.0.1:{port}/?user_id=...&access_token=...`, where `access_token` is RSA-encrypted against the public key. The client decrypts it locally and stores `user_id` plus the plaintext token. There is no refresh, because the token is long-lived. Decryption is RSA-OAEP with SHA-256 only and fails closed: PKCS#1 v1.5 has no integrity check, so decrypting a token meant for another key could produce arbitrary UTF-8 that is stored as a valid session. The callback accepts a path plus query, a bare query or a lone query string, and only the query part is parsed so a leading path never becomes part of the first parameter name. The keypair is bound to a port, so the route derives `native_app_port` from the local callback URL and prefers `defaultNativeAppPort` (58443) so the redirect matches what Zed expects, falling back to a random port when busy. Because `exchangeTokens` re-runs `prepareConfig` and would mint a different one, the `system_id` embedded in the sign-in URL is surfaced to the frontend and threaded through register-session, exchange and the stored connection. The exchange never mints a fresh `system_id` itself, since the stored id would otherwise be unrelated to the zed.dev login. The manual-fallback path needs the same attempt material (redirect URI, RSA verifier, `system_id`). The live Zed model catalog is never hardcoded: the registry has an empty static catalog with passthrough, and `/api/providers/[id]/models` resolves it live with the connection's own credentials, returning an explicit warning on empty or failure instead of a silent zero list.

**Where:** `open-sse/shared/zedAuth.js`: key encoding, decrypt, callback parsing, catalog resolver; `src/lib/oauth/providers/zed.js`; `src/lib/oauth/providers/index.js`: `prepareConfig` / `exchangeTokens` plumbing; `src/lib/oauth/constants/oauth.js`: `ZED_HOSTED_CONFIG`; `src/app/api/oauth/[provider]/[action]/route.js`: authorize, exchange; `src/app/api/providers/[id]/models/route.js`: Zed branch; `open-sse/providers/registry/zed.js`

### D2. Xiaomi MiMo uses an X25519 ECDH encrypted callback, not standard OAuth2

The client generates an X25519 keypair and opens `${platformUrl}/authorize?pk=<pubkey>&redirect_uri=http://localhost:<port>/&kn=mimocode&key_name=...`. The callback arrives as `?u=<base64 encrypted payload>` with layout `[12-byte nonce][32-byte ephemeral pubkey][ciphertext][16-byte GCM tag]`. Decryption derives the key as SHA-256 of the ECDH shared secret and uses AES-256-GCM, yielding `{ uid, sk, url }`. The SPKI of an X25519 key is 44 bytes with the raw key in the last 32, but the platform expects the full base64 SPKI, so it is passed as-is. The `key_name` is deterministic per machine, so the OAuth provider layer needs no filesystem writes, and the platform treats it as a label only.

**Where:** `src/lib/oauth/providers/xiaomi-mimo.js`: `publicKeyDer`, decrypt helper, `getKeyName`; `src/lib/oauth/constants/oauth.js`: Xiaomi MiMo config

### D3. Trae and Windsurf are local-callback flows with provider-specific matching

Trae (ByteDance marscode) runs: POST `GetLoginGuidance {loginTraceID}`, open `${loginHost}/authorization?...&login_trace_id=...&auth_callback_url=${cb}`, receive `${cb}?refreshToken=...&loginHost=...&isRedirect=true`, POST `ExchangeToken` (`ClientSecret: "-"`), then `GetUserInfo` with `x-cloudide-token`. It matches the callback by `loginTraceID` (set by `prepareConfig`), not by PKCE state. SOLO `common_params` identity fields `web_id` and `biz_user_id` are not exposed by `GetUserInfo`, and empty strings are accepted upstream (verified). Windsurf / Devin CLI uses an implicit flow: it opens `windsurf.com/windsurf/signin?response_type=token&...`, receives `?access_token=<firebaseJWT>&state=...`, POSTs `RegisterUser`, then `GetOneTimeAuthToken` and `GetCurrentUser` (email and plan, best effort).

**Where:** `src/lib/oauth/constants/oauth.js`: `TRAE_CONFIG`, `WINDSURF_CONFIG`; `src/lib/oauth/providers/trae.js`; `src/lib/oauth/providers/index.js`

### D4. Qoder uses a custom device flow with a deliberately conservative expiry

PKCE, a nonce and a `machine_id` are generated locally. The user lands on `qoder.com/device/selectAccounts` and the client polls `openapi.qoder.sh` until a `dt-...` token appears. To match the device-code shape the modal expects, `device_code` is the nonce and `codeVerifier` is the PKCE verifier, since the poll endpoint identifies the client by nonce plus verifier rather than a server-issued code. HTTP 202 and 404 both mean keep polling. Device tokens live about 30 days (access) and 360 (refresh), but the upstream refresh endpoint at `center.qoder.sh` returns 403 for this flow, so the user is asked to re-login instead of rotating silently. `expireTime` is a Unix-ms timestamp, a pure-numeric string is read as ms-epoch (so `Date.parse` does not treat short numerics as years), the default is now plus 30 days when upstream omits expiry, and `expiresInSeconds === 0` means already expired. The stored expiry is floored at one day so a stale or skewed timestamp cannot truncate it below something useful. When `fetchUserInfo` silently returns an empty email, a synthetic identifier derived from `userId` is used, because dedup in `createProviderConnection` requires a non-empty email and otherwise re-logins accumulate "Account N" duplicates. Helper calls have a timeout (the modal polls every 2s for up to 5 minutes) and run under an `AbortController`, since a stalled socket otherwise hangs on Node's keepalive for minutes and abandoned polls accumulate. The `machineId` and `nonce` are passed through `extraData` so `mapTokens` can persist the machine id for COSY signing.

**Where:** `src/lib/oauth/providers/qoder.js`; `src/lib/oauth/services/qoder.js`: timeout wrapper, `parseExpiry`, polling; `src/lib/oauth/constants/oauth.js`: Qoder config

### D5. Kiro: kiro:// redirect, profileArn resolution and API-key validation

AWS Cognito only whitelists the `kiro://` custom protocol, not localhost, so the social-login URL uses it, and the code exchange must use the same `redirect_uri`. Kiro IDC/Builder-ID tokens lack a `profileArn` and are resolved via ListAvailableProfiles to avoid 403. API keys do not support `TokenType=API_KEY` on that call and use the Amazon Q model catalog. A bearer-only ListAvailableProfiles call can return 200 with an empty list for an arbitrary key, so it proves nothing. Validation goes through the same Amazon Q surface used for inference. Kiro API keys are account-bound and need no `profileArn`.

**Where:** `src/lib/oauth/services/kiro.js`: social login URL, code exchange, profile listing, API-key validation; `src/lib/oauth/providers/index.js`: Kiro profileArn step

### D6. Grok CLI, Kimi, CodeBuddy and Antigravity quirks

Grok CLI uses a plain device_code flow with no PKCE challenge (per HAR), against `cli-chat-proxy.grok.com` with the same client id as xAI but different flow and scopes. A 402 spending-limit response is a soft success (auth works, the account cannot spend), so the connection stays active with a warning. An absolute expiry is surfaced so proactive refresh can renew the xAI token before it silently expires about 40-45 minutes after login. Only the reactive 401 path would otherwise refresh, producing intermittent "token expired" errors. Kimi returns 200 for pending states with an `error` field, and needs `_kimiDeviceId` for a stable `X-Msh-Device-Id`. CodeBuddy polls the token endpoint with GET and the state as a query param, as the official CLI does, where code 11217 means pending and 0 means success. Antigravity preserves the registered spelling for both authorization and token exchange. Cursor has no public refresh endpoint. xAI's id_token email is decoded without signature verification (mirroring CLIProxyAPI) and the xAI helpers are inlined so the web route bundle stays free of the CLI-only `open` package.

**Where:** `src/lib/oauth/providers/grok-cli.js`; `src/lib/oauth/providers/kimi.js`; `src/lib/oauth/providers/codebuddy-cn.js`; `src/lib/oauth/providers/antigravity.js`; `src/lib/oauth/providers/xai.js`; `src/lib/oauth/services/xai.js`; `src/app/api/providers/[id]/test/testUtils.js`: OAuth probe classifier; `src/app/api/oauth/[provider]/[action]/route.js`

### D7. API-key connections persist a long expiry horizon, and codex bulk import is serial

Kiro and Xiaomi MiMo API keys do not expire on a fixed schedule, so a long horizon (365 days) is persisted. This keeps proactive refresh, which needs a refresh token anyway, out of the picture. Codex bulk import runs a serial loop because `createProviderConnection` reads max(priority) and reorders inside a transaction, and parallel calls would race on priority assignment.

**Where:** `src/app/api/oauth/kiro/api-key/route.js`; `src/app/api/oauth/xiaomi-mimo/api-key/route.js`; `src/app/api/oauth/codex/bulk-import/route.js`

### D8. Exchange-time extra data and no-PKCE providers

The device-code response and exchange pass provider-specific data through `extraData`: Kiro's client id and secret, Kimi's `_kimiDeviceId` (for CLIProxyAPI parity), and Qoder's PKCE verifier and machine id. Providers that do not use PKCE for device code (Grok CLI) are listed separately so no challenge is sent. Legacy kimi-coding OAuth connections are saved under the dual-auth kimi provider. Codex requires a fixed port 1455 and path `/auth/callback` on the CLI side, and the `OAUTH_ENDPOINTS` entry differs from `claude.authorizeUrl` (the claude.ai login) and must be kept.

**Where:** `src/app/api/oauth/[provider]/[action]/route.js`: `noPkceProviders`, exchange; `cli/src/cli/api/client.js`: `getOAuthAuthUrl`; `open-sse/config/appConstants.js`: `OAUTH_ENDPOINTS`

## Consequences

- Minting a new Zed `system_id`/port during exchange, or decrypting with a fallback padding, stores unusable or forged sessions.
- Treating Qoder or Kiro expiry and email/profile like a standard OAuth provider causes truncated tokens, duplicate accounts, or 403s.
- Parallelizing bulk import corrupts connection priorities.
- Removing the Grok CLI expiry or soft-success handling causes intermittent expired-token failures or false failures on spend-limited accounts.
- Using a localhost redirect for Kiro social login fails the Cognito whitelist.
