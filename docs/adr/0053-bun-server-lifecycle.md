# ADR-0053: Bun server lifecycle: shutdown, idle timeouts and client disconnects

- Status: Accepted
- Date: 2026-11-23
- Origin: Plan 2 (Bun.serve server) tasks 7 and 14; final whole-branch review

## Context

`src/server/index.js` is a single `Bun.serve` process. Three behaviours that used to be handled by `custom-server.js` and Next have to be stated explicitly, because each one is easy to break without a failing request: what happens on SIGTERM/SIGINT, how long an idle connection lives, and what a client disconnect does to a request that is still streaming.

## Decisions

### D1. The server's own signal handler is registered first, drains the DB adapter and exits 0

`initializeApp` registers `process.on("SIGTERM", () => process.exit())` at boot, while the bun:sqlite adapter registers its drain handler lazily on first DB use. Signal handlers run in registration order, so whenever the bootstrap handler came first the process exited with code 0 before the usage, request-detail and signature buffers were written; about a third of runs lost the buffered rows. `installShutdownHandlers` in `src/server/shutdown.js` is therefore called in the entry block before `startServer`, so its `once` handler for SIGINT and SIGTERM always runs first. `flushAndExit` closes the open DB adapter (which drains the buffers and checkpoints the WAL), falls back to `drainRuntimeBuffersSync` when no adapter was opened, logs and continues if either throws, and exits 0. The handler is synchronous on purpose (ADR 0008 D1). Under `bun --hot` the entry block runs again on every reload, so installation is guarded by `globalThis.__lrShutdownInstalled` and the listeners exist once per process. Windows cannot deliver SIGTERM to a Bun child, so the real-process cases run on Linux CI and the two unit cases of `flushAndExit` run everywhere.

**Where:** `src/server/shutdown.js`; `src/server/index.js`: entry block; `src/lib/db/shutdown.js`; `tests/server/shutdown.test.js`

### D2. Idle timeout is 255 s, and long-lived paths opt out per request

`Bun.serve` closes a connection after `idleTimeout` seconds without bytes, and 255 is its maximum. Next had no equivalent cut for the gateway, and an upstream that thinks for minutes before the first token, or a quiet SSE stream, must not be dropped by the server in front of it. So `idleTimeout` is 255 and the paths that can stay silent longer call `server.timeout(req, 0)`: `/v1`, `/v1beta`, `/codex`, `/responses`, `/api/v1*`, the console-log and usage streams, and the two pxpipe routes that carried `maxDuration` under Next. The exemption runs in the route adapter after the guard, so an unauthenticated slow-loris caller never reaches it. Ordinary dashboard routes keep the 255 s cut. The previous 120 s h2c read timeout is gone because h2c is served as ordinary HTTP/1.1 (ADR 0001 D10).

**Where:** `src/server/index.js`: `IDLE_TIMEOUT_SECONDS`; `src/server/adapter.js`: `isLongLived`; `tests/server/timeouts.test.js`

### D3. A client disconnect is `request.signal`, and handlers that rebuild a Request must forward it

Bun aborts `request.signal` within a second of the client closing the socket. The `/v1` chat path hands that signal to `chatCore`, whose abort handling is ADR 0012 D7/D8, and cancelling the downstream stream closes the upstream connection. Handlers that construct a new `Request` from the incoming one (`v1/responses/compact`, `v1beta`) pass `{ signal: request.signal }` so the signal keeps propagating. An oversize body is answered 413 by Bun itself before the handler finishes reading; the rejected `req.text()` that follows is an expected outcome, so `serve` in `src/server/index.js` answers it quietly instead of logging a stack trace for every such request.

**Where:** `src/server/index.js`: `serve`; `src/app/api/v1/responses/compact/route.js`; `tests/server/disconnect.test.js`; `tests/server/body-limit.test.js`

## Consequences

- Moving the signal-handler installation after `startServer`, or making it per reload, brings back the lost usage rows or the pile of duplicate listeners.
- A new route that can stay silent for more than 255 s must be added to the long-lived list, or Bun will cut it.
- Anything that replaces the incoming `Request` without forwarding `signal` leaves the upstream call running after the client is gone.
