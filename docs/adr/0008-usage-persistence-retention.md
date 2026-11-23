# ADR-0008: Usage persistence, rollups and retention

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Usage history, request details and the dashboard stats are written and read while live SSE streams are running. Writes are buffered off the request path, reads must stay cheap as history grows, and the SQLite adapter closes the database on SIGTERM/SIGINT. These decisions keep the event loop free, keep stats cost independent of request volume, and make sure buffered rows survive shutdown.

## Decisions

### D1. Buffers are drained synchronously and first on shutdown

Usage and request-detail writes are buffered off the request path, so every DB adapter must flush those accepted events before closing or persisting the database; otherwise fallback runtimes lose the tail of usage history. The drain is synchronous (bun:sqlite is sync, so no await and no race with a closing connection). The boot code (`initializeApp`) also listens on SIGTERM/SIGINT and exits immediately, so the Bun server registers its own handler first (`src/server/shutdown.js`, ADR 0053 D1), which closes the adapter and exits 0, and every signal handler must be synchronous. The adapter calls the drain before `db.close()`. The handler is exported, not just called inline, because bundlers tree-shake unreferenced module-level side effects out of the route.

**Where:** `src/lib/db/shutdown.js`; `src/server/shutdown.js`; `src/lib/db/repos/requestDetailsRepo.js`: the drain function and the signal handler registration; `tests/unit/usage-detail-signal-drain.test.js`, `tests/unit/usage-detail-buffer-bound.test.js`

### D2. Stats read a 10-minute rollup, with a hard recompute floor

24h and today stats read the 10-minute rollup for whole buckets plus raw history only for the single partial bucket at the sliding cutoff, so cost is O(buckets x tuples) regardless of request volume. Dimension tuples are interned in `usageRollupKey` so the rollup groups on one integer instead of five text columns. Cached tuple ids can disappear when a transaction rolls back (AUTOINCREMENT may reissue the id), so callers must drop the cache on rollback. Stats reads inside a hard floor return the previous result (stale by at most the floor), so many tabs plus a push-per-batch SSE feed cost one query set per floor; the recompute is synchronous so it is single-flight. Migration 005 backfills the rollup before usage rows exist, so the migrator rebuilds it after importing legacy usage.

**Where:** `src/lib/db/repos/usageRepo.js`: the stats computation and its cache floor; `src/lib/db/usageRollup.js`: `usageRollupKey`; `src/lib/db/migrate.js`: legacy usage import step

### D3. usageDaily is cached parsed and written back lazily; saves are durable when awaited

`usageDaily` aggregates stay parsed in memory and are written back on a slower cadence, on shutdown, and before any read, instead of read+parse+stringify of the whole day blob per flush. Aggregation runs after the history insert commits so a rolled-back batch never double-counts. `saveRequestUsage` keeps its public contract that awaiting it means the event is durable; production response handlers deliberately do not await it so they still benefit from batching.

**Where:** `src/lib/db/repos/usageRepo.js`: the daily aggregate cache and `saveRequestUsage`

### D4. Retention: prune usageHistory, never usageDaily; cap request details

Per-request `usageHistory` rows are kept for a configurable number of days (0 = forever); `usageDaily` aggregates are never pruned so all-time totals stay correct. Request details are capped at 15,000 rows (about 33 hours at 11k requests/day, so a stall remains readable the next day; worst case about 315 MB at roughly 21 KiB per row; issue #147). `OBSERVABILITY_MAX_RECORDS` (a positive integer) overrides the dashboard setting so ops can pin it and is clamped to `MAX_RECORDS_CEILING`.

**Where:** `src/lib/db/repos/settingsRepo.js`: usage retention setting; `src/lib/db/repos/requestDetailsRepo.js`: record cap resolution

### D5. Bound records at enqueue and flush in small chunks

Request-detail records are size-bounded when enqueued, so the write buffer only holds small objects and a 5 MB base64 body never sits in memory awaiting a flush. Strings are measured by `.length` and objects by a single walk that never stringifies. Flushes use small transactions with a macrotask yield between them so a backlog never freezes the event loop for live streams.

**Where:** `src/lib/db/repos/requestDetailsRepo.js`: enqueue bounding and the flush loop

### D6. Streamed requests write usage exactly once

No placeholder row is written up front. A streamed request writes once when it ends, whether completed, aborted or cancelled by the client.

**Where:** `open-sse/handlers/chatCore/streamingHandler.js`

### D7. Do not parse JSON blobs for listings; redact payloads in details

`usage/providers` queries the DISTINCT provider column directly; parsing every row's full JSON blob (potentially hundreds of MB) previously caused OOM. `usage/request-details` drops request and response message content (prompts, tool calls, provider responses) and keeps only metadata (model, tokens, latency, status), because returning stored bodies would let any dashboard user, or anyone when requireLogin is disabled, read every user's conversations.

**Where:** `src/app/api/usage/providers/route.js`; `src/app/api/usage/request-details/route.js`

### D8. Live usage feed is lightweight; clients refetch totals and clean up via request.signal

`usage/stream` emits only the live fields the dashboard merges in real time (`activeRequests`, `recentRequests`, `errorProvider`, pending). Period totals are not computed per client per event because `getUsageStats()` is O(history). A persisted-usage update carries `refresh: true` and the client refetches `/api/usage/stats` on a debounce; the UI merges only real-time fields and never overwrites full REST stats. Both SSE routes (usage and console logs) clean up on `request.signal` abort, because `ReadableStream.cancel()` is not reliably invoked in Next.js and listeners leaked on closed tabs.

**Where:** `src/app/api/usage/stream/route.js`; `src/app/api/console-logs/stream/route.js`; `src/shared/components/UsageStats.js`

### D9. Legacy date-only keys are local, not UTC

A bare `YYYY-MM-DD` key is not a timestamp. `Date.parse` reads it as UTC midnight, which misorders it against real instants whenever the local day differs from the UTC day. Comparisons use real ISO timestamps only, and the synthetic `lastUsed` for legacy day rows is built manually as local end-of-day, clamped to now.

**Where:** `src/lib/db/repos/usageRepo.js`: legacy day-row `lastUsed` construction and timestamp comparison

### D10. Request logging is async and credential-safe

All request-logger fs work is async so logging never blocks the event loop and every live stream; only the lazy module load is sync. It keeps one long-lived append stream per (session, file) instead of `appendFileSync` per chunk, and streams close themselves after a quiet spell so finished requests hold no file descriptor. Client keys are fingerprinted and other credentials redacted before any header reaches a log file (see `keyFingerprint.js`).

**Where:** `open-sse/utils/requestLogger.js`

## Consequences

- An async or late-registered shutdown drain finds a closed DB and loses buffered usage and request details.
- Computing stats from raw history per event or per tab turns SSE pushes into O(history) work.
- Pruning `usageDaily` or caching tuple ids across a rollback corrupts all-time totals and rollup keys.
- Unbounded enqueued records or per-chunk sync file writes stall every live stream.
- Returning stored request bodies leaks user conversations.
