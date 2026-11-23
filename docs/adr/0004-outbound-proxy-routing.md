# ADR-0004: Outbound proxy routing and strict mode

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

All upstream traffic leaves through a patched global `fetch` (`proxyFetch`) that supports per-connection proxy pools, relay-style pools (Vercel, Cloudflare, Deno, Netlify), and a direct path on Bun's native `fetch` (proxied calls pass `proxy: <normalized url>`). Operators can mark a pool "strict", meaning traffic must never leave over the host's real IP. The direct path also has to cope with upstream edges that silently drop idle sockets. These decisions describe how strictness, keep-alive replay and relay deployment behave.

## Decisions

### D1. Strict proxy fails closed; it never falls back to a direct connection

Strict mode means "never leave over the direct IP" (issue #4333). If a proxy is intended but cannot be resolved (inactive or empty pool, pool removed, pool saved without a url), the request is refused instead of going direct. `resolveConnectionProxyConfig` therefore keeps `strictProxy:true` even for an unusable strict pool. `proxyAwareFetch` applies the refusal only when a proxy is intended, because the Qoder executor sets `strictProxy` to mean "do not replay this request directly if the proxy fails" (a replayed COSY signature returns 403), not "a proxy is required"; with nothing configured Qoder must keep working. The catch blocks around an attempted proxy only cover a proxy that was actually tried.

**Where:** `open-sse/utils/proxyFetch.js`: `proxyAwareFetch` (proxyIntended gate); `src/lib/network/connectionProxy.js`: `resolveConnectionProxyConfig` (`poolStrictProxy`); `tests/unit/strict-proxy-enforcement.test.js`

### D2. The Cursor h2 path enforces strict policy itself

The Cursor AgentService uses Node http2 duplex streams and bypasses `proxyAwareFetch`, so the strict guarantee never applies there automatically (h2 proxying is tracked in #3276). `cursor.js` honors the policy side: when a proxy is intended, strict and unresolved, it fails closed rather than opening a direct socket that exposes the real IP. Non-strict callers keep the direct behavior.

**Where:** `open-sse/executors/cursor.js`: `proxyIntentFailed` and its use before the h2 stream is opened

### D3. Direct path: capped keep-alive and a single fresh-socket replay

Upstream edges (Cloudflare, AWS Global Accelerator) drop idle sockets without a RST, which once hung requests about 249s before a 502. Bun's `fetch` exposes no keep-alive TTL, so the former 4 s keep-alive cap (`FETCH_KEEPALIVE_TIMEOUT_MS`, `resolveKeepAliveTimeouts`) is inert: nothing in the transport reads it. Protection against edge-dropped sockets now rests entirely on the one-shot fresh-socket replay: when a pooled socket dies before response headers, `proxyFetch` replays once with `keepalive: false` (a new connection) instead of waiting out the connect timeout. Only errors proving socket death qualify (never a bare "fetch failed", since the upstream may already hold the request and a replay would bill it twice); DNS, refused-connect and TLS failures are excluded so a really unreachable host is not mistaken for a stale socket. Only bodies that can be sent twice are replayable (fail closed: a stream is consumable once). The residual risk that `UND_ERR_SOCKET` / "other side closed" fires after the body was written, causing a rare double POST, is accepted and matches the executor's own 502 retry. `FETCH_FRESH_RETRY=off` removes the replay. Headers timeouts must not assume the upstream is idle, since it may be generating after receiving the request.

**Where:** `open-sse/utils/proxyFetch.js`: `isStaleSocketError`, `isBodyReplaySafe`, `directFetch`; `open-sse/config/runtimeConfig.js`; `tests/unit/proxy-keepalive-dead-socket.test.js`

### D4. Raw proxyAwareFetch callers are still bounded

Callers that pass no signal or timer, such as token refresh, must still be bounded by a backstop timeout inside `proxyAwareFetch`.

**Where:** `open-sse/utils/proxyFetch.js`: `proxyAwareFetch`; `tests/unit/proxyfetch-backstop.test.js`

### D5. proxyFetch must be loaded to patch global fetch, and loaded first

`open-sse/index.js` imports `./utils/proxyFetch.js` as its first import so the global `fetch` is patched before any module captures it. Entry points that do not use the barrel (the chat handler, usage routes) import `proxyFetch` or `open-sse/index.js` for the same side effect. Catalog probes such as the commandcode model list use the patched global `fetch` so the chat path's proxy and keep-alive policy covers them too; no credentials are sent.

**Where:** `open-sse/index.js`; `src/sse/handlers/chat.js`; `src/app/api/usage/[connectionId]/route.js`; `src/app/api/usage/[connectionId]/codex-reset-credits/route.js`; `open-sse/services/commandcodeModels.js`

### D6. Relay pools rewrite the base URL; Netlify needs a Lambda-style handler

Vercel, Cloudflare, Deno and Netlify relay pools work by base URL rewriting with relay headers (`x-relay-target`, `x-relay-path`), not `HTTP_PROXY` env vars, and are all mapped into one unified payload field (`vercelRelayUrl`) because the header spec is identical, so `proxyAwareFetch` needs no per-relay changes. Netlify digest deploys run no build step, so the function is served at `/.netlify/functions/relay` and runs on the Lambda-compatible runtime: the bundle must use `exports.handler(event)` returning a string body. ESM export-default syntax gives `Runtime.UserCodeSyntaxError` (502) and a stream body gives a Go unmarshal error (502). The response mirrors the other relays: relay headers stripped, status and body passed through.

**Where:** `src/lib/network/connectionProxy.js`: relay branch; `src/lib/network/netlifyRelay.js`: `NETLIFY_RELAY_FUNCTION_CODE`

### D7. Outbound proxy env handling only touches managed variables

The outbound proxy settings code records which proxy env vars it set (a managed marker). When disabled or empty it clears only values it previously managed, never overwriting or clearing externally provided env vars, and drops the marker once everything it set is cleared. Initialization is deferred so the HTTP server accepts connections first.

**Where:** `src/lib/network/outboundProxy.js`; `src/lib/network/initOutboundProxy.js`

### D8. Advertise zstd only on Node 22.15+

zstd decoding exists only from Node 22.15 (`zlib.createZstdDecompress`). Advertising zstd in `Accept-Encoding` on an older runtime returns a body undici cannot inflate, giving raw bytes where JSON/SSE is expected (issue #5539).

**Where:** `open-sse/utils/zstdCompat.js`: `ACCEPT_ENCODING`

### D9. Cursor streams are bounded and map timeouts to 504

The Cursor executor bounds connect/headers time, idle time between chunks and (non-stream) total time. A violation fails the stream with `GatewayTimeoutError`, which the gateway maps to 504 without penalizing the account.

**Where:** `open-sse/executors/cursor.js`: `timeoutFail`; `open-sse/utils/requestTimeouts.js`

## Consequences

- A strict pool that falls back to direct on inactive or empty pools leaks the host IP, the exact failure of issue #4333.
- Treating `strictProxy` as "a proxy is required" breaks Qoder when no proxy is configured; dropping it allows a direct replay that returns 403.
- Replaying on a bare "fetch failed" or with a consumed stream double-bills or sends truncated bodies.
- Importing anything that captures `fetch` before `proxyFetch` leaves that code unproxied.
- A Netlify relay using ESM or streaming syntax returns 502 on every call; advertising zstd on old Node returns undecodable bodies.
