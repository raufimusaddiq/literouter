# ADR-0001: Trusted proxy and client IP derivation

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

LiteRouter makes several security decisions from the client's IP address: login lockout buckets, failed-API-key throttling, "local operator" exemptions (SSRF guard bypass, localhost-only routes such as auto-import and password reset) and the default-password login rule. Forwarding headers (`X-Forwarded-For`, `X-Real-IP`, `Host`) are fully client-controlled unless something trusted rewrites them. The production deployment sits behind a reverse proxy (Caddy, optionally Cloudflare), so loopback peers are often proxy hops rather than local operators. `src/server/index.js` (the `Bun.serve` entry) establishes what can be trusted through `src/server/trust.js`; everything else must consume that output rather than re-deriving it. Several of these rules came from security advisories (GHSA-pjm4-8fpg-f9p6, #3294; CVE-2026-56679 class).

## Decisions

### D1. Only the Bun server asserts the peer address, from the socket, through a request context

`src/server/index.js` reads the peer address from the TCP socket (`server.requestIP(req)`), builds `{ peerIp, clientIp, isLocal }` with `buildRequestContext` in `src/server/trust.js`, and stores it in a WeakMap keyed by the `Request` (`setRequestContext` in `src/server/context.js`). Guard, rate limiters and handlers read it with `getRequestContext`; nothing re-derives locality from `Host` or forwarding headers. The context never travels as a header, so a client cannot forge it. Before the guard runs, the server deletes `x-9r-real-ip`, `x-9r-peer-token`, `x-9r-via-proxy` and `x-forwarded-for` from the request (`STRIPPED_HEADERS`). Those names belonged to the retired Next wrapper, which proved it had run by stamping a per-process `x-9r-peer-token`; with one server and no unwrapped path that proof has nothing left to prove, so the token, `NINEROUTER_PEER_TOKEN` and `src/lib/auth/trustedPeer.js` are gone, and a guard test fails if any source reads them again. Access-granting headers must still never be snapshotted into request details (which the dashboard renders and cloud sync uploads).

Under Next, a direct loopback request was never local: Next 16's base server added `x-forwarded-*` to every request, so every request carried a proxy marker (D3). Under Bun a direct loopback request with no proxy marker and no non-loopback `Origin` is local. This is a deliberate change, recorded as the "Local-trust change" entries in `tests/parity/known-diffs.json`. Cloudflare to Caddy to loopback stays remote because Caddy sends `X-Forwarded-*`.

**Where:** `src/server/index.js`: `serve`, `STRIPPED_HEADERS`; `src/server/trust.js`: `buildRequestContext`; `src/server/context.js`: `setRequestContext`, `getRequestContext`; `src/server/guard.js`: `isLocalRequest`; `src/lib/auth/loginLimiter.js`: `getClientIp`; `tests/server/peer-headers.test.js`; `tests/server/trust.test.js`; `tests/server/no-next-server.test.js`; `tests/unit/local-request-peer-trust-3294.test.js`

### D2. There is one entry point, and it is the Bun server

`bun src/server/index.js` (`bun --hot` in development) is the only way to serve the app, so there is no bare `server.js` or `next start` path that skips the context. `npm run dev` under Next treated every request as remote because the wrapper never loaded; `bun --hot` sees real peer addresses. The published CLI and the Dockerfile still describe the Next standalone build until Plan 4 rebuilds them; `scripts/copy-standalone-assets.mjs` no longer copies a wrapper into the standalone output.

**Where:** `src/server/index.js`: `startServer`; `package.json`: `dev`, `start`; `scripts/copy-standalone-assets.mjs`; `tests/unit/standalone-assets.test.js`

### D3. A loopback peer carrying proxy markers is a proxy hop, not a local operator

Any of `x-forwarded-for`, `x-real-ip`, `forwarded`, `x-forwarded-proto`, `x-forwarded-host`, `via`, `cf-connecting-ip` or `true-client-ip` on a loopback peer means a reverse proxy or CDN hop, so the request is not local. Caddy sends `X-Forwarded-*`, but a bare nginx `proxy_pass` sends none, hence the operator opt-out `TRUST_LOOPBACK_AS_LOCAL=false`, which treats every loopback peer as a proxy hop. The marker list now lives only in `src/lib/auth/proxyMarkers.js`, imported by `src/server/trust.js`; the inline copy the wrapper needed is gone.

**Where:** `src/lib/auth/proxyMarkers.js`: `PROXY_MARKER_HEADERS`, `hasProxyMarker`; `src/server/trust.js`: `buildRequestContext`; `src/server/guard.js`: `isLocalRequest`; `tests/unit/key-hardening.test.js`

### D4. Trust forwarding headers only from a loopback proxy, and use the rightmost XFF hop

Forwarding headers are honored only when the TCP peer is a local reverse proxy; direct or public sockets stay keyed by the unspoofable peer address. A proxy appends the hop it accepted to the right of `X-Forwarded-For`, so the rightmost entry is the one the trusted proxy observed, while the leftmost is whatever the client sent and must never key a rate-limit or lockout bucket. The assumption is exactly one trusted loopback proxy hop; with a longer chain the rightmost entry is an inner proxy rather than the client. `deriveClientIp` in `src/server/trust.js` applies the rule once (`X-Real-IP`, else rightmost XFF, only from a loopback peer) and `loginLimiter` reads the result from the request context.

**Where:** `src/server/trust.js`: `deriveClientIp`; `src/lib/auth/loginLimiter.js`: `getClientIp`; `tests/server/trust.test.js`; `tests/server/peer-headers.test.js`

### D5. Host and address parsing must be IPv6-aware

Host headers, URL hostnames and raw socket addresses are parsed with IPv6-aware splitting. Splitting on the first colon works only for IPv4 and reduced every IPv6 form to an empty string, so a dual-stack listener reporting loopback as `::ffff:127.0.0.1` did not read as loopback.

**Where:** `src/server/trust.js`: `isLoopbackAddress`; `src/server/guard.js`; `tests/server/trust.test.js`; `tests/unit/local-request-peer-trust-3294.test.js`

### D6. Login attempts are counted before the slow password compare

The login route calls `beginAttempt` before the bcrypt compare, recording the attempt as a failure up front. Parallel guesses would otherwise all read the same pre-lockout count, pass `checkLock` together, and land several tries inside one budget. A successful login deletes the entry, so a correct password still resets the window.

**Where:** `src/app/api/auth/login/route.js`: `POST`; `src/lib/auth/loginLimiter.js`: `beginAttempt`; `tests/unit/login-lockout.test.js`

### D7. No session token for the default password on a remote client

When the default password (`123456`) is still in use and the request is not local, login does not issue a JWT and demands a password change first. A fresh install's default password is public, so a valid JWT would let any remote attacker authenticate and, for example, PATCH `/api/settings` to disable authentication (CVE-2026-56679 class). This deliberately leaves no remote self-service password change, because that flow needs a JWT. A remote fresh-install user must change the password from the local machine or set `INITIAL_PASSWORD` before first launch.

**Where:** `src/app/api/auth/login/route.js`: `POST` (default-password branch)

### D8. Valid API keys bypass the failed-auth IP block; the throttle is lenient

The public gateway's failed-auth throttle counts only failed key validations per client IP, in memory and bounded. Valid keys and the CLI token always pass, because behind Cloudflare without Caddy `trusted_proxies` many users share one edge IP and must not be locked out together. Only requests that failed validation get a 429 (body shaped for the Anthropic, Gemini or OpenAI route) while the IP is blocked.

**Where:** `src/lib/auth/apiKeyThrottle.js`; `src/server/guard.js`: API-key gate

### D9. The system CA store is opt-in and fails closed

Bun verifies TLS against its bundled roots, not the OS bundle, so patching `ca-certificates` in an image does not remove a distrusted root. When `LITEROUTER_SYSTEM_CA=1` (set in the Dockerfile) the entry block of `src/server/index.js` (`import.meta.main`, not `startServer`, so a caller that only imports `startServer` gets no CA check) calls `useSystemCaStore` in `src/server/ca.js` once, before the server starts, replacing the process-wide default CA list that `node:tls`, `node:https` and `node:http2` use with the OS bundle, and wrapping `globalThis.fetch` so every call carries `tls: { ca: <system list> }` unless the caller passed its own `tls.ca`. Calling it again replaces the wrapper instead of stacking a second one. It throws, so the server refuses to start, if `tls.setDefaultCACertificates` is unavailable or the system store is empty, never silently keeping the bundled roots. It is opt-in so installs without a usable system store keep working. Under `bun --hot` the call is guarded by `globalThis.__lrSystemCaInstalled` and runs once per process.

**Bun 1.4.4 specifics:** `fetch` ignores `tls.setDefaultCACertificates` (probed with a self-signed TLS server: `fetch` still fails after the default list is replaced, `node:https` succeeds; `NODE_EXTRA_CA_CERTS` is additive only, and `bun --use-system-ca` made no difference), and `tls: { ca: [] }` means "unset". That is why `useSystemCaStore` wraps `fetch` instead of relying on the default list, and why an empty system store is a startup error rather than an empty `ca`. The system store therefore applies to the gateway's upstream `fetch` calls and to the `node:*` TLS clients (for example the cursor executor).

**Where:** `src/server/ca.js`: `useSystemCaStore`; `src/server/index.js`: the `import.meta.main` block; `tests/server/ca.test.js`, `tests/unit/system-ca-trust.test.js`

### D10. h2c upgrade requests are served as HTTP/1.1 and the body cap is explicit

JBR 25 sends h2c upgrades that an HTTP/1.1 server would otherwise close. `Bun.serve` serves them itself as ordinary HTTP/1.1 requests, so the Node downgrade shim is gone. The body ceiling is `maxRequestBodySize`, parsed by `parseBodyLimit` from `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` (default 128mb), so an h2c request cannot buffer more than any other request and an oversized one is answered 413. A chunked h2c request now arrives with its body intact instead of being rejected with 411.

**Where:** `src/server/bodyLimit.js`: `parseBodyLimit`; `src/server/index.js`: `startServer`; `tests/server/h2c.test.js`; `tests/server/body-limit.test.js`

## Consequences

- Reading `x-forwarded-for` / `x-real-ip` / `Host` directly for IP or locality decisions re-opens client IP spoofing, lockout evasion and remote access to localhost-only routes.
- Putting back an entry point that does not build the request context, or a proxy chain longer than one hop, silently changes who counts as local or which IP keys a bucket.
- Re-introducing a second copy of the proxy-marker list lets the copies drift so proxied requests look local on one code path.
- Issuing a session for the default password remotely, or counting login attempts after the bcrypt compare, restores the remote takeover and parallel-guess bypass.
- Throttling by IP without exempting valid keys locks out unrelated users behind a shared CDN edge.
