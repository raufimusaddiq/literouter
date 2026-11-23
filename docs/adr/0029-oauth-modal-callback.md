# ADR-0029: OAuth modal, callback and session handling

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

OAuth logins complete through three pieces. The `OAuthModal` React component drives the flow. The `/callback` page relays the result to the opener. Loopback "proxy" servers in `src/lib/oauth/utils/server.js` receive redirects for providers with local callbacks (Codex, xAI, Trae, Windsurf, Zed, Xiaomi MiMo). The loopback listeners are reachable from any web page in the user's browser, and the sessions they hold include secrets (the Zed RSA and Xiaomi X25519 private keys). Both facts shape the CSRF, origin and logging rules below. The modal must also survive React re-renders and StrictMode without opening extra tabs or double-stopping proxies.

## Decisions

### D1. Loopback callback servers reject cross-origin requests and bad state

Legitimate OAuth redirects are top-level navigations and carry no `Origin` header. A cross-site page issuing `fetch(..., {mode: "no-cors"})` to scan and hit `127.0.0.1` always sends `Origin: https://attacker`. `isLoopbackOrigin` rejects any non-loopback Origin to block login CSRF. Codex, xAI and similar sessions also reject a state mismatch when state is present, and require state present and matching where applicable. Zed tokens are RSA-encrypted to our keypair so they cannot be forged cross-site, but cross-origin fetches are still rejected as defense in depth. Zed and Xiaomi callbacks carry no `state` param, so the proxy tries every pending session's private key and accepts the one that decrypts. A genuine Zed redirect always carries `user_id` and `access_token`. Anything else (probe, prefetch, stray navigation, favicon-style miss) is answered without touching the session and without stopping the server, so the real redirect can still land afterwards. A failed attempt does not stop the Zed proxy either, because the failure may belong to a superseded attempt (an older popup landing after "Try Again" registered a new keypair). The idle timeout and modal close bound the listener. A reused live listener renews its idle timeout so a previous flow's deadline cannot kill the flow that just adopted the port.

**Where:** `src/lib/oauth/utils/server.js`: `isLoopbackOrigin`, `startLocalServer`, `startCodexProxy`, `startXaiProxy`, `startZedProxy`, `startXiaomiMimoProxy`

### D2. Secrets stay out of URLs, logs and client responses

Zed's `codeVerifier` encodes the RSA private key. Session registration is therefore a POST with `state` and `codeVerifier` in the body (`register-session`), never in the URL or query string where logs would capture it. The Zed proxy logs path plus redacted params, because `access_token` is the RSA-encrypted credential. Session status responses never leak the private key to the client. When a proxy stops, no callback can arrive anymore, so every pending Xiaomi session is dropped, since each holds an X25519 private key and they would otherwise accumulate for the process lifetime (one per `/authorize` call). The Windsurf proxy decrypts using the private key stored in `session.codeVerifier`.

**Where:** `src/app/api/oauth/[provider]/[action]/route.js`: register-session POST handler; `src/lib/oauth/utils/server.js`: `startZedProxy` (logging), session status helpers, `stopXiaomiMimoProxy`; `src/shared/components/OAuthModal.js`: register-session call

### D3. The callback page relays only to expected origins, one at a time

The `/callback` page may hand the code and state only to the dashboard window we expect to be the opener (same origin) or to the Codex helper listening on a fixed loopback port. Any other origin is treated as hostile (a drive-by page that opened the popup against the well-known `redirect_uri` to phish the code). `postMessage` is sent once per allowed origin, never with `"*"`, because the browser then delivers only when the opener's origin matches `targetOrigin`. On the receiving side, `OAuthModal.handleMessage` accepts only the dashboard origin or this attempt's exact callback origin.

**Where:** `src/web/pages/callback/page.js`: `expectedOrigins`, relay logic; `src/shared/components/OAuthModal.js`: `handleMessage`

### D4. Proxy-flow sessions are server-side and survive until exchange

Trae, Windsurf and Zed use a dynamic-port local callback server (singleton session). State is registered separately via `/register-session` after `/authorize`, so the proxy can match the incoming callback. For the provider that does not auto-exchange server-side, a finished session must survive until the client POSTs `/exchange`, which clears it. A failed session is cleared immediately instead.

**Where:** `src/app/api/oauth/[provider]/[action]/route.js`: authorize, status and exchange handlers; `src/lib/oauth/utils/server.js`: `registerZedSession`, `getZedSessionStatus`, `clearZedSession`

### D5. The modal owns its proxy session exactly once and tolerates re-renders

The modal keeps a ledger of which provider's proxy this session started and whether its stop was already sent (`openedRef`). Every `stop-proxy` call is gated on it, so parent re-renders can never spam stop and a close stops exactly once. Ownership is taken immediately after start, so a close during the remaining in-flight request still cleans the proxy up. All close paths (effect close, button, Escape or backdrop) funnel through one idempotent cleanup. Parent callbacks live in refs, synced after every render with no dependency array, so effect identities stay stable even though the page passes fresh inline closures. The open effect depends only on stable primitives and is guarded by `openedRef`, so StrictMode and effect reruns never open extra tabs. Before this, every parent render re-fired `stop-proxy` while the modal was closed. The flow-start function is deliberately a plain function, because memoizing it would add an identity that re-triggers effects on every parent re-render. All `useCallback` hooks are defined before the effects that reference them. Client-only values (the fallback placeholder) are initialized client-side to avoid hydration mismatch.

**Where:** `src/shared/components/OAuthModal.js`: `openedRef`, `flowRef`, the open effect, the close/cleanup effect, `startOAuthFlow`

### D6. Device-code polling honors upstream expiry and never opens a null URL

The poll deadline uses the upstream's `expires_in` when supplied (Qoder sets 300s) so the modal does not time out before the device code itself. The default is 120s, matching previous behaviour for providers that give no value. Device-code providers return `authUrl: null` from `/authorize`, so the modal never calls `window.open(null)`, which browsers coerce to the relative path `.../null`. Kiro (`_clientId`, `_clientSecret`) and Qoder (`_qoderMachineId`, `_qoderNonce`) pass `extraData` through poll so `mapTokens` can persist the machine id alongside the token.

**Where:** `src/shared/components/OAuthModal.js`: `startPolling`, `startOAuthFlow`, poll call

## Consequences

- Dropping the Origin check lets any web page trigger or poison local login callbacks (login CSRF).
- Sending secrets in URLs or logging unredacted callback params leaks Zed/Xiaomi private keys or tokens into server logs.
- Using `postMessage` with `"*"`, or relaying to unlisted origins, leaks the OAuth code to a phishing opener.
- Stopping the proxy on stray requests or on superseded failures kills the real login. Failing to stop it, or to drop sessions, leaks listeners and private keys.
- Unstable effect dependencies re-open tabs or fire repeated `stop-proxy` calls.
