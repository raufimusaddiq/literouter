# Phase — Usage buffer bounds and shutdown drain

PRD §24 requires the usage/observability side path to be bounded, to apply a
documented drop policy on overflow, and to flush pending events within a fixed
timeout on shutdown. This phase records what was found and what now holds.

## Defects found

1. **Unbounded buffer.** `requestDetailsRepo` pushed every detail into a plain
   module-level array. Under a stalled or slow DB the array grew without limit.
2. **Module-level state is not shared.** Next bundles the repo once per entry,
   so the buffer the HTTP route wrote to was not the buffer any other instance
   could see. Any drain from elsewhere drained an empty array.
3. **The only reachable drain lost a race.** The SQLite adapter registers
   `SIGTERM`/`SIGINT` handlers that call `db.close()` and then `process.exit(0)`.
   An asynchronous drain registered elsewhere could not finish, and a `process.exit`
   path cannot await at all.
4. **The shutdown handler was tree-shaken.** A module-level side-effect call
   with no exported reference is removed by the bundler, so no drain shipped.
5. **Silent test no-ops.** `@/` aliases only resolve under `tests/vitest.config.js`.
   Running vitest from the repository root skipped that config, so imports threw,
   `catch(() => null)` swallowed it, and the tests passed without executing.

## What now holds

- The queue lives on `globalThis.__liteRouterDetailBuffer`, so every bundled
  instance shares one buffer.
- The queue is capped (`observabilityMaxBuffered`, default 500). On overflow the
  oldest detail is dropped once and an operational error is logged.
- The drain is synchronous. `better-sqlite3` is synchronous, so no drain needs
  to await and none can lose a race against a closing connection.
- The drain runs *before* the adapter closes: the adapter calls
  `globalThis.__liteRouterDrainSync()` ahead of `db.close()`.
- `flushRequestDetails()` is exported through `usageDb`/`db/index` and is used by
  `POST /api/shutdown`.

## Evidence

Unit (`cd tests && npx vitest run`):

- drops oldest instead of growing without bound — passes
- `flushRequestDetails` drains the buffer synchronously — passes
- installs a synchronous signal drain — passes
- persists buffered rows on the signal path — passes

Live staging (`literouter-staging`, `2026-09-19`):

| Step | Value |
|---|---|
| `requestDetails` before | 69 |
| 5 chat requests, observability on | — |
| `docker stop -t 15` then start | — |
| `requestDetails` after | **74** |

All five buffered rows survived shutdown. Health returned 200 after restart.

## Known ceiling

The drop policy is drop-oldest and lossy by design; it protects the request path
from a stalled DB. Upgrade path if losing observability rows becomes
unacceptable: spool to a Redis stream or disk queue instead of dropping.
