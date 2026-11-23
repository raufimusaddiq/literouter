# ADR-0001: Trusted proxy and client IP derivation

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

LiteRouter makes several security decisions from the client's IP address: login lockout buckets, failed-API-key throttling, "local operator" exemptions (SSRF guard bypass, localhost-only routes such as auto-import and password reset) and the default-password login rule. Forwarding headers (`X-Forwarded-For`, `X-Real-IP`, `Host`) are fully client-controlled unless something trusted rewrites them. The production deployment sits behind a reverse proxy (Caddy, optionally Cloudflare), so loopback peers are often proxy hops rather than local operators. `custom-server.js` wraps the Next server to establish what can be trusted; everything else must consume its output rather than re-deriving it. Several of these rules came from security advisories (GHSA-pjm4-8fpg-f9p6, #3294; CVE-2026-56679 class).

## Decisions

### D1. Only custom-server.js may assert the peer address, proven by a per-process token

`custom-server.js` derives the client IP from the TCP socket, strips every client-supplied forwarding header, and overwrites `x-9r-real-ip`. It then stamps `x-9r-peer-token`, a random secret generated at process boot, on every request it handles (not only proxied ones). Downstream code trusts `x-9r-real-ip` only when the request carries a matching token. A bare `next dev` / `next start` never loads the wrapper, so it cannot produce the token even though the env var is inherited by child processes. Without the token, local-operator exemptions are denied, because Host and `x-9r-real-ip` are attacker-controlled and cannot prove loopback. The header is named like `x-9r-cli-token` so the request-detail header sanitizer redacts it, and access-granting headers must never be snapshotted into request details (which the dashboard renders and cloud sync uploads).

**Where:** `custom-server.js`: request wrapper that stamps `x-9r-real-ip` and `x-9r-peer-token` (`PEER_TOKEN`); `src/lib/auth/trustedPeer.js`: peer-token check; `src/dashboardGuard.js`: local-request and client-IP resolution; `src/lib/auth/loginLimiter.js`: `getClientIp`; `tests/unit/custom-server-peer-headers.test.js`; `tests/unit/local-request-peer-trust-3294.test.js`

### D2. The CLI and repo-checkout paths must also go through the wrapper

The published CLI prefers `custom-server.js` (the build copies it into the bundle) over the bare standalone `server.js`, because only the wrapper injects the real socket IP. In a repo checkout with no standalone build, the wrapper runs `next start` in-process so every request is still sanitized. A standalone layout without the wrapper beside `server.js` has nothing that can prove a request is local.

**Where:** `cli/cli.js`: server entry selection; `custom-server.js`: repo-checkout fallback; `tests/unit/standalone-assets.test.js`

### D3. A loopback peer carrying proxy markers is a proxy hop, not a local operator

Any of `x-forwarded-for`, `x-real-ip`, `forwarded`, `x-forwarded-proto`, `x-forwarded-host`, `via`, `cf-connecting-ip` or `true-client-ip` on a loopback peer means a reverse proxy or CDN hop, so the request is not local. Caddy sends `X-Forwarded-*`, but a bare nginx `proxy_pass` sends none, hence the operator opt-out `TRUST_LOOPBACK_AS_LOCAL=false`, which treats every loopback peer as a proxy hop. The marker list lives in `src/lib/auth/proxyMarkers.js` and is duplicated inline in `custom-server.js` because the wrapper cannot import from `src/`; the two copies must be kept in sync.

**Where:** `custom-server.js`: `PROXY_MARKERS` / `trustLoopback`; `src/lib/auth/proxyMarkers.js`; `src/dashboardGuard.js`: loopback-as-local check

### D4. Trust forwarding headers only from a loopback proxy, and use the rightmost XFF hop

Forwarding headers are honored only when the TCP peer is a local reverse proxy; direct or public sockets stay keyed by the unspoofable peer address. A proxy appends the hop it accepted to the right of `X-Forwarded-For`, so the rightmost entry is the one the trusted proxy observed, while the leftmost is whatever the client sent and must never key a rate-limit or lockout bucket. The assumption is exactly one trusted loopback proxy hop; with a longer chain the rightmost entry is an inner proxy rather than the client. `loginLimiter` applies the same rule (`X-Real-IP`, else rightmost XFF) and, when exposed directly without the wrapper, collapses to a single bucket so rotating a spoofed XFF cannot escape lockout.

**Where:** `custom-server.js`: client IP derivation; `src/lib/auth/loginLimiter.js`: `getClientIp`; `tests/unit/custom-server-peer-headers.test.js`

### D5. Host and address parsing must be IPv6-aware

Host headers, URL hostnames and raw socket addresses are parsed with IPv6-aware splitting. Splitting on the first colon works only for IPv4 and reduced every IPv6 form to an empty string, so a dual-stack listener reporting loopback as `::ffff:127.0.0.1` did not read as loopback.

**Where:** `src/dashboardGuard.js`: host/address normalization; `tests/unit/local-request-peer-trust-3294.test.js`

### D6. Login attempts are counted before the slow password compare

The login route calls `beginAttempt` before the bcrypt compare, recording the attempt as a failure up front. Parallel guesses would otherwise all read the same pre-lockout count, pass `checkLock` together, and land several tries inside one budget. A successful login deletes the entry, so a correct password still resets the window.

**Where:** `src/app/api/auth/login/route.js`: `POST`; `src/lib/auth/loginLimiter.js`: `beginAttempt`; `tests/unit/login-lockout.test.js`

### D7. No session token for the default password on a remote client

When the default password (`123456`) is still in use and the request is not local, login does not issue a JWT and demands a password change first. A fresh install's default password is public, so a valid JWT would let any remote attacker authenticate and, for example, PATCH `/api/settings` to disable authentication (CVE-2026-56679 class). This deliberately leaves no remote self-service password change, because that flow needs a JWT. A remote fresh-install user must change the password from the local machine or set `INITIAL_PASSWORD` before first launch.

**Where:** `src/app/api/auth/login/route.js`: `POST` (default-password branch)

### D8. Valid API keys bypass the failed-auth IP block; the throttle is lenient

The public gateway's failed-auth throttle counts only failed key validations per client IP, in memory and bounded. Valid keys and the CLI token always pass, because behind Cloudflare without Caddy `trusted_proxies` many users share one edge IP and must not be locked out together. Only requests that failed validation get a 429 (body shaped for the Anthropic, Gemini or OpenAI route) while the IP is blocked.

**Where:** `src/lib/auth/apiKeyThrottle.js`; `src/dashboardGuard.js`: API-key gate

### D9. The system CA store is opt-in and fails closed

Node verifies TLS against its bundled Mozilla roots, not the OS bundle, so patching `ca-certificates` in an image does not remove a distrusted root. When `LITEROUTER_SYSTEM_CA=1` (set in the Dockerfile) the wrapper replaces the process-wide default CA list once, before any outbound connection, so every client that does not pass its own `ca` (global fetch, undici, https.get) uses the OS bundle. This needs Node >= 22.19 (`tls.setDefaultCACertificates`) and refuses to start if no usable system store exists, never silently keeping the bundled roots. It is opt-in so CLI installs on older Node keep working.

**Where:** `custom-server.js`: system CA setup guarded by `LITEROUTER_SYSTEM_CA`

### D10. The h2c downgrade path mirrors normal limits and rejects chunked upgrades

JBR 25 sends h2c upgrades that the HTTP/1.1 server would otherwise close, so the wrapper handles them. Its body ceiling equals Next's `proxyClientMaxBodySize` (`NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE`, default 128mb), so the downgrade path cannot buffer more than the normal request path. Chunked framing inside an upgrade is not replayable as HTTP/1.1 and used to reach the parser as a bodyless POST, so it is rejected explicitly.

**Where:** `custom-server.js`: `MAX_H2C_BODY_BYTES` and the h2c upgrade handler

## Consequences

- Reading `x-forwarded-for` / `x-real-ip` / `Host` directly for IP or locality decisions re-opens client IP spoofing, lockout evasion and remote access to localhost-only routes.
- Running `next dev` / `next start` without the wrapper, or a proxy chain longer than one hop, silently changes who counts as local or which IP keys a bucket.
- Adding a proxy-marker header to only one of the two lists makes proxied requests look local on one code path.
- Issuing a session for the default password remotely, or counting login attempts after the bcrypt compare, restores the remote takeover and parallel-guess bypass.
- Throttling by IP without exempting valid keys locks out unrelated users behind a shared CDN edge.
