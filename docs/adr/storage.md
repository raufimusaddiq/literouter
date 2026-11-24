# Storage and usage

SQLite on `bun:sqlite` only, under `src/lib/db/`.

## Database

- **Schema: bump `SCHEMA_VERSION` by 1 on every change; `TABLES` is additive only.** The bump triggers the one-time pre-change backup (forgetting it only skips the backup). Drop/rename/type change needs a versioned migration. `ADD COLUMN` cannot carry PRIMARY KEY/UNIQUE, so sync strips them. Capture DB freshness before migrations stamp `_meta`. Where: `src/lib/db/schema.js`, `src/lib/db/migrate.js`.
- **Legacy `db.json` import is transactional and re-armed by a marker.** `.migrated-from-json` stops a re-import after the user wipes `data.sqlite`; a row-count mismatch rolls back, writes no marker and retries next boot. Where: `migrate.js` `importWithAssertion`.
- **Backups are a pre-migration net, not a restore path, and omit `requestDetails`** (a multi-hundred-MB DB backs up as a few MB). Importing a backup without per-key `access` means unrestricted; a malformed `access` is refused. Where: `src/lib/db/backup.js`.
- **Anything that writes around a repo must drop that repo's cache** (raw SQL upserts in `aliasRepo`, backup import). `configVersion` is bumped by every write that changes routing/auth (combos, aliases, key allow lists); derived caches key on it. `apiKeysRepo` caches the key table; a TTL bounds how long a revoked key survives in another process. Where: `src/lib/db/configVersion.js`, `src/lib/db/index.js`.
- **Redis (multi-replica only) version bump happens after the SQLite commit, fails open.** Bumping inside the transaction lets another replica cache the old snapshot under the new version. Single instance skips Redis. Where: `connectionsRepo.js` `invalidateConnectionCacheEverywhere`.
- **Finalize cached statements before `close(true)`** or Windows keeps the file locked (EBUSY). Where: `src/lib/db/adapters/bunSqliteAdapter.js`.
- **Shutdown drains buffers first and synchronously** (usage, request details, `flushPendingSignaturesSync` for the 1s unref'd signature timer), then closes the DB; every signal handler is synchronous. Anchor singletons (driver, request-details queue, schedulers like `quotaAutoPing`) on `globalThis`, or `bun --hot` double-initializes them. Where: `src/lib/db/shutdown.js`, `src/server/shutdown.js`.
- **A Unix-style absolute `DATA_DIR` is ignored on Windows.** Where: `src/lib/dataDir.js`.
- Usage lives in the same SQLite database as everything else and follows `DATA_DIR`. Where: `src/lib/db/repos/*`.
- **The data-dir resolver lives in `cli/hooks/dataDir.js` (CommonJS)**: the default is `~/.literouter`, or `~/.9router` when only that exists; it never creates the default. The published CLI ships only `cli.js`, `src`, `hooks` and `app`, so the server imports it relatively and the bundle inlines it; keep it dependency-free. Where: `cli/hooks/dataDir.js`, `src/lib/dataDir.js`.

## Connections

- **Merge OAuth refresh tokens and counters inside the write transaction.** Refresh tokens are single-use and rotate; `backoffLevel` derived from an earlier snapshot makes concurrent failures compute the same level. Where: `connectionsRepo.js` `mutateProviderConnection`.
- **Patch the cached snapshot before the first `await`** so round-robin selection interleaved with the write sees fresh rows; only a priority change drops the whole snapshot. Snapshot reload is single-flight with a generation check, and callers loop until a snapshot exists. Where: `connectionsRepo.js` `optimisticPatchCachedConnection`, `ensureConnectionCache`.
- **Provider insert must stay O(1) (issue #4311).** New row takes `MAX(priority)+1` in SQL, no pool scan or renumber (a 5k-key import was ~25M statements); `reorderInTx` is for deletes and explicit reorders, inside a transaction. An api-key name collision returns 409 unless the caller passes `allowOverwrite`. Where: `connectionsRepo.js` `createProviderConnection`.
- **OAuth identity matching never collapses distinct accounts.** Codex issues several grants per email with single-use refresh tokens: update an existing Codex row only when ChatGPT account IDs match; other providers match email plus username, and a missing username on one side means distinct. Where: `createProviderConnection`.
- **Delete cleared `modelLock_*` keys, never store null** (readers enumerate the keys). Where: `pruneClearedLocks`.
- **Dual-auth providers (codebuddy-cn, xai) live under category "oauth" but accept API keys**, so `POST /api/providers` allows them explicitly. Where: `src/app/api/providers/route.js`.
- **The round-robin cursor is process-global runtime state**, not persisted (a write, cache invalidation and Redis bump per request otherwise). Where: `src/sse/services/auth.js` `selectionState`.

## Usage

- **24h/today stats read a 10-minute rollup plus raw rows only for the partial bucket**, with dimension tuples interned in `usageRollupKey`. Drop the tuple cache on rollback (AUTOINCREMENT may reissue ids). Stats recompute is rate-limited by a floor and single-flight. Migration 005 backfills the rollup before usage rows exist, so the migrator rebuilds it after legacy import. Where: `src/lib/db/usageRollup.js`, `usageRepo.js`.
- **Prune `usageHistory` by retention days (0 = forever), never `usageDaily`** (all-time totals). Request details are capped at 15,000 rows (~33 h at 11k req/day, ~315 MB worst case, issue #147); `OBSERVABILITY_MAX_RECORDS` overrides, clamped to `MAX_RECORDS_CEILING`. Where: `settingsRepo.js`, `requestDetailsRepo.js`.
- **Bound request-detail records at enqueue** (a 5 MB base64 body must not sit in the buffer), measure without stringifying, and flush in small transactions with a macrotask yield. `usageDaily` stays parsed in memory and is written lazily; aggregation runs after the history insert commits. Reading days never flushes: dirty in-memory days overlay the stored rows, and stored rows are parsed once and reused while their text is unchanged (up to 400 days). The today/24h chart groups by hour in SQL (`julianday`, not `unixepoch(..., 'subsec')`, which older system SQLite lacks). Where: `requestDetailsRepo.js`, `usageRepo.js` (`loadDaysInRange`, `hourlyTotals`).
- **A streamed request writes usage exactly once, at the end** (completed, aborted or cancelled); no placeholder row. Where: `open-sse/handlers/chatCore/streamingHandler.js`.
- **`usage/request-details` returns metadata only**, never prompts or responses (they would leak every user's conversations, and everyone when `requireLogin` is off). `usage/providers` queries DISTINCT provider; parsing blobs OOMed. Where: `src/app/api/usage/`.
- **`usage/stream` emits live fields only**; period totals are O(history), so a persisted-usage event carries `refresh: true` and the client refetches `/api/usage/stats` debounced. SSE routes clean up on `request.signal` abort. Where: `src/app/api/usage/stream/route.js`.
- **A bare `YYYY-MM-DD` key is local, not UTC**: `Date.parse` reads UTC midnight and misorders; legacy day rows get a local end-of-day `lastUsed` clamped to now. Where: `usageRepo.js`.
- **The request logger is fully async** with one append stream per (session, file) that closes after a quiet spell; credentials are redacted and client keys fingerprinted before any header is logged. Where: `open-sse/utils/requestLogger.js`.
