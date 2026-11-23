# Outbound requests

How upstream traffic leaves the process: patched `fetch`, proxies, timeouts, retries.

## Proxy and fetch

- **Strict proxy fails closed (issue #4333).** If a proxy is intended but unresolvable (inactive/empty/removed pool, no url), refuse; never go direct. `resolveConnectionProxyConfig` keeps `strictProxy:true` for an unusable strict pool. `proxyAwareFetch` refuses only when a proxy is intended: Qoder sets `strictProxy` to mean "do not replay directly" (a replayed COSY signature returns 403), not "proxy required". Where: `open-sse/utils/proxyFetch.js` `proxyAwareFetch`, `src/lib/network/connectionProxy.js`.
- **Cursor's h2 path bypasses `proxyAwareFetch`, so `cursor.js` enforces strict itself** and fails closed instead of opening a direct socket (h2 proxying tracked in #3276). Where: `open-sse/executors/cursor.js` `proxyIntentFailed`.
- **Stale keep-alive sockets are handled by one fresh-socket replay.** Edges (Cloudflare, AWS Global Accelerator) drop idle sockets without RST (a request once hung ~249s). Bun `fetch` has no keep-alive TTL, so when a pooled socket dies before response headers `proxyFetch` replays once with `keepalive:false`. Only errors proving socket death qualify, never a bare "fetch failed" (would double-bill); DNS, refused-connect and TLS errors are excluded; only replayable bodies (a stream is single-use). `FETCH_FRESH_RETRY=off` disables. Where: `open-sse/utils/proxyFetch.js` `isStaleSocketError`, `isBodyReplaySafe`.
- **Raw `proxyAwareFetch` callers (token refresh) still get a backstop timeout.** Where: `proxyAwareFetch`.
- **`proxyFetch` must be the first import of `open-sse/index.js`** so the global `fetch` is patched before anything captures it; entry points that skip the barrel import it directly. Catalog probes use the patched global `fetch`. Where: `open-sse/index.js`, `src/sse/handlers/chat.js`.
- **Relay pools rewrite the base URL** (`x-relay-target`, `x-relay-path`) for Vercel, Cloudflare, Deno and Netlify, all mapped to one `vercelRelayUrl` field. Netlify digest deploys run no build, so the function must be Lambda-style `exports.handler(event)` returning a string body (ESM export or stream body gives 502). Where: `src/lib/network/connectionProxy.js`, `src/lib/network/netlifyRelay.js`.
- **Outbound proxy env handling clears only variables it set** (managed marker), never externally provided ones; init is deferred so the server accepts connections first. Where: `src/lib/network/outboundProxy.js`.
- **`proxy` is a Bun-only `fetch` option.** On other runtimes `guardProxyRuntime` throws for strict proxies and warns once otherwise. Where: `open-sse/utils/proxyFetch.js` `guardProxyRuntime`.
- **Advertise zstd only where it can be decoded** (issue #5539): raw bytes otherwise. Where: `open-sse/utils/zstdCompat.js`.
- **Cursor streams are bounded** (connect, idle between chunks, total for non-stream); violation is `GatewayTimeoutError` mapped to 504 without penalizing the account. Where: `open-sse/executors/cursor.js` `timeoutFail`.
