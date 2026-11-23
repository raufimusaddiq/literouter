# ADR-0012: Timeouts, retries, abort handling and error sanitization

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Upstream providers hang, stall mid-stream, return HTML error pages with HTTP 200, and drop idle keep-alive sockets without a TCP RST. The gateway must bound every wait, retry only when a replay cannot double-bill a completion, and keep timeouts and client aborts from being mistaken for account health problems. Timeouts live in `open-sse/config/runtimeConfig.js`, with the watchdogs in `open-sse/utils/` and the stream finalization in `chatCore`.

## Decisions

### D1. Gateway watchdogs always fire before the undici backstop

There are three distinct bounds: a headers timeout (streaming requests, until response headers arrive, `FETCH_CONNECT_TIMEOUT_MS` 60s), a total timeout (non-stream requests, whole call including body, `NON_STREAM_TOTAL_TIMEOUT_MS` 10 min, since non-stream upstreams send headers only once done), and an idle timeout between chunks (`readWithIdleTimeout`). `UNDICI_BACKSTOP_MS` (name kept for env compatibility, enforced by `fetchWithBackstop` in `proxyFetch`, not by an undici Agent) is a safety net for the 60+ raw `proxyAwareFetch` callers (token refresh, vertex/qoder/trae) that have no timer of their own. It is sized above every gateway watchdog (the max of them plus 30s) so those always fire first with a proper 504. The backstop is a timer armed from the call until headers arrive and again only while a body read is pending (idle time between chunks), so long healthy streams are unaffected. It is disarmed on clean end, `cancel()`, caller abort and body error so no timer outlives the response. Its abort error is a `TypeError("fetch failed")` whose `cause` carries `name`/`code` `HeadersTimeoutError`/`UND_ERR_HEADERS_TIMEOUT` before headers and `BodyTimeoutError`/`UND_ERR_BODY_TIMEOUT` after, so existing classifiers (for example the v1beta route's 504 mapping) see what undici used to produce. None of these bounds says anything about account health.

**Where:** `open-sse/config/runtimeConfig.js`: `FETCH_CONNECT_TIMEOUT_MS`, `NON_STREAM_TOTAL_TIMEOUT_MS`, `UNDICI_BACKSTOP_MS`; `open-sse/utils/requestTimeouts.js`

### D2. Stall detection tracks raw upstream bytes, not transform output

The stall watchdog in `pipeWithDisconnect` resets on any upstream chunk and aborts the fetch via the controller after `STREAM_STALL_TIMEOUT_MS` (360s default) of silence. Reasoning models (Claude thinking via Kiro, Kiro EventStream binary frames buffering) can emit zero SSE output for long stretches while partial frames keep arriving; measuring transform output caused false stalls and the Next "failed to pipe response" error. The timeout is deliberately generous so slow reasoning models are not aborted mid-stream. The controller is wrapped so every termination path (abort, cancel, downstream error) clears the stall timer; otherwise a stale abort could fire after the request ended.

**Where:** `open-sse/utils/streamHandler.js`: `createStreamController`, `pipeWithDisconnect`; `open-sse/config/runtimeConfig.js`: `STREAM_STALL_TIMEOUT_MS`

### D3. Shorter stall timeout for DeepSeek Flash lanes

The opencode-go and kenari DeepSeek Flash lanes accept the request, send about 2 chunks, then go silent forever. Flash does not do long silent reasoning, so those hangs are cut at 90s (`STREAM_STALL_TIMEOUT_FLASH_MS`) instead of 360s.

**Where:** `open-sse/config/runtimeConfig.js`: `STREAM_STALL_TIMEOUT_FLASH_MS`

### D4. Replay on a stale socket only when it cannot double-bill

Under undici, keep-alive sockets were capped (`FETCH_KEEPALIVE_TIMEOUT_MS`, default 4s) below upstream/edge idle windows (Cloudflare, AWS Global Accelerator, NVIDIA NIM). Bun's `fetch` has no such option, so the TTL cap and `resolveKeepAliveTimeouts` are inert (kept in `runtimeConfig.js` until Plan 2 trims config). Protection against edge-dropped sockets rests on the one-shot fresh-socket replay (`keepalive: false`). Dead sockets surface as `UND_ERR_SOCKET`, `ECONNRESET`, `EPIPE` or "other side closed" / "socket hang up", and the transport replays once on a fresh socket. DNS, connect-refused and TLS failures are excluded so a genuinely unreachable host is never mistaken for a stale socket. A bare "fetch failed" with no error code is deliberately excluded: the upstream may already hold the request and replay would bill the same completion twice. `FETCH_FRESH_RETRY=off` disables the replay, leaving the executor's own retry path (which still forces a fresh socket). There is no proxy dispatcher cache any more: `PROXY_DISPATCHERS_MAX_SIZE` / `MEMORY_CONFIG.proxyDispatchersMaxSize` is inert, and Bun manages proxy connection reuse itself.

**Where:** `open-sse/config/runtimeConfig.js`: `resolveKeepAliveTimeouts`, `isFreshSocketReplayEnabled`, `STALE_SOCKET_ERROR_CODES`, `NON_STALE_SOCKET_ERROR_CODES`, `STALE_SOCKET_ERROR_SUBSTRINGS`, `MEMORY_CONFIG.proxyDispatchersMaxSize`

### D5. HTTP retry table never replays a 504

`DEFAULT_RETRY_CONFIG` retries 408 once ("request body timed out", the upstream never processed it) and 502/503 up to three times; pre-send and connect failures retry under the 502 entry. There is intentionally no 504 entry, because an upstream 504 may already be a billed generation, so it is surfaced once and never replayed.

**Where:** `open-sse/config/runtimeConfig.js`: `DEFAULT_RETRY_CONFIG`

### D6. A 2xx non-SSE body is a broken upstream, sanitized

When upstream returns HTML or text instead of SSE (for example a Cloudflare 5xx page), piping it through the SSE transform crashes the chat router with "failed to pipe response". The handler reads the body, extracts a short message from the `<title>`, strips HTML tags, clamps the length, and returns a clean JSON error, because the UI may render `error.message` as HTML and untrusted upstream text must never reach the client verbatim. It surfaces as a real 502 (kept if upstream already said 4xx/5xx). A login or auth page means the credential is bad (401, account scope); anything else takes the short transient lock via the 502 default. Combo exceptions likewise keep message and stack server-side and return a generic message to clients.

**Where:** `open-sse/handlers/chatCore/streamingHandler.js`; `open-sse/services/combo.js`

### D7. Client aborts and gateway timeouts never lock an account

`chatCore` guarantees the pending-request counter is released on any throw, and a client abort or gateway timeout surfaces as a typed result (499 / 504) instead of a throw. Callers must not lock the account for either, since neither says anything about its health; on a 401 refresh path, a client-gone or timeout state stops before surfacing the stale 401 that would lock the account.

**Where:** `open-sse/handlers/chatCore.js`: the entry function and the token-refresh retry branch

### D8. Health credit is earned by finishing a stream, and aborted streams end loudly

Clearing locks and resetting backoff happens when a stream finishes, not when it starts; a stream that stalls or breaks midway must not reset backoff, and a flush racing a prior abort stays a failure. A client-cancelled finalize records usage but is not an upstream health success. If a stream aborts after HTTP 200 was already sent, terminal bytes are emitted so the client sees a real error rather than a silent truncation: the Responses passthrough keeps its own `response.failed` shape, other formats get the OpenAI error frame plus `[DONE]`, and Claude gets `event: error`. When the stall timer or an upstream reset wins, the error row is the only usage write for the request, and a late transform flush must not turn it into a success.

**Where:** `open-sse/handlers/chatCore/streamingHandler.js`; `open-sse/utils/streamHandler.js`: `createStreamController` (`onAbortTerminal`)

### D9. Streaming mode forcing and probe budgets

Image generation models require non-streaming (Google `v1internal:generateContent`). DeepSeek-TUI interactive mode sends `stream: true` and needs SSE, while its non-interactive `-p` mode sends no `stream` and cannot parse SSE, so non-streaming is forced only when the client did not explicitly request streaming. An `Accept: application/json` header is honored as a non-streaming preference (AI SDK compatibility). The dashboard model-test probe budget (`MODEL_TEST_TIMEOUT_MS`, 200s) is measured to the first token and shares the first-chunk default, because a smaller budget would report healthy-but-slow models as broken.

**Where:** `open-sse/handlers/chatCore.js`: stream decision logic; `open-sse/config/runtimeConfig.js`: `MODEL_TEST_TIMEOUT_MS`

## Consequences

- Making the backstop smaller than a gateway watchdog turns clean 504s into raw socket errors.
- Measuring stalls on transform output aborts healthy reasoning streams and brings back "failed to pipe response".
- Replaying bare "fetch failed" or any 504 can bill a completion twice.
- Counting a timeout, client abort or truncated stream as an account failure (or success) corrupts lock and backoff state.
- Reflecting upstream HTML or exception text to clients risks XSS and leaks stack data.
