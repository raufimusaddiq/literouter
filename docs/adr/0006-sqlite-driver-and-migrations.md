# ADR-0006: SQLite driver chain, migrations and data directory

- Status: Accepted. The driver chain is superseded: `src/lib/db/driver.js` now uses `bun:sqlite` only and the better-sqlite3, node:sqlite and sql.js adapters are gone. D2, D8 and D9 (and the better-sqlite3/node:sqlite parts of D1 and D7) are kept as history; the NUL-safe wrapper, migrations, data directory, cache and shutdown-ordering decisions still apply.
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

All persistent state lives in a SQLite layer under `src/lib/db/` that picks one of several drivers at runtime (bun:sqlite, better-sqlite3, node:sqlite, sql.js). The drivers differ in how they handle native bindings, TEXT values, WAL files and persistence, and Next.js bundles modules per route, so module-level state is not reliably shared. Repos also keep in-process caches (and in multi-replica mode a Redis version) in front of SQLite. These decisions record the constraints that keep the layer consistent across drivers and across processes.

## Decisions

### D1. Bound strings are made NUL-safe once, in driver.js, for every driver

SQLite binds TEXT as a NUL-terminated C string. better-sqlite3 rejects an embedded NUL ("String contains null byte"), which aborts the write and the background flush worker, while node:sqlite silently keeps only the prefix. Telemetry carries values that can hold NULs (model ids and endpoints from the request, tool output, diffs). The adapter wrapper in `driver.js` strips NUL bytes from every bound string via the `helpers/nullBytes.js` helper, so one rule covers all drivers and column types. Non-string values (numbers, null, Buffers/TypedArrays bound as BLOBs) pass through untouched, and JSON columns need nothing because `JSON.stringify` escapes control characters. This is regression #4917.

**Where:** `src/lib/db/driver.js`: NUL-safe adapter wrapper; `src/lib/db/helpers/nullBytes.js`: string sanitizer; `tests/unit/db-null-byte-params.test.js`

### D2. Skip better-sqlite3 on Node >= 24

The better-sqlite3 native addon SIGSEGVs on load on Node 24 and later. That is a process-level crash the try/catch around the import cannot recover from, so `tryBetterSqlite` returns null up front by Node major version and node:sqlite takes over. It is also skipped on Bun.

**Where:** `src/lib/db/driver.js`: `tryBetterSqlite`

### D3. Redis cache versioning: bump after SQLite commit, fail open, multi-replica only

`connectionsRepo` keeps a per-process snapshot (L1) and, in explicit multi-replica mode, a Redis invalidation version (L2, PRD 15.5) so a UI mutation on one replica cannot leave another serving stale connections. The version bump is awaited by callers after the SQLite commit. Bumping inside the transaction could expose the new version before the rows are visible, letting another replica reload the old snapshot and cache it under the new version until the TTL expires. The version-check interval is separate from `CACHE_TTL_MS`: the data TTL can be long because foreign writes are caught by the frequent version check. On Redis failure the check fails open and local invalidation still covers the process. Single-instance deployments skip Redis entirely, so the inference hot path pays no round-trips, and Redis is never a required dependency of a normal read.

**Where:** `src/lib/db/repos/connectionsRepo.js`: `invalidateConnectionCacheEverywhere`, `cacheVersion`, `bumpCacheVersion`, `ensureConnectionCache`

### D4. Repo caches must be dropped by anything that writes around them

Repo modules cache derived data. A raw SQL write bypasses their writers, so it must drop the cache itself: `aliasRepo` upserts via raw SQL (atomic upsert) and drops the cached scope as `kv.set` does, and the backup import in `db/index.js` clears repo caches after a raw SQL restore so the restore is visible to routing immediately. `apiKeysRepo` caches the whole (tiny) key table per PRD 15.1/15.2 to avoid a SQLite hit per request; a TTL bounds how long a key revoked by another process stays usable, and UI mutations invalidate directly. `configVersion` is a monotonic counter bumped by every write that can change routing/auth decisions (combos, model aliases, key allow lists); derived caches key on it so an edit is visible immediately.

**Where:** `src/lib/db/repos/aliasRepo.js`; `src/lib/db/index.js`: backup import; `src/lib/db/repos/apiKeysRepo.js`; `src/lib/db/configVersion.js`: `bumpConfigVersion`, `getConfigVersion`

### D5. Shutdown ordering: drain buffers before closing the DB

`betterSqliteAdapter` registers a shutdown handler that closes the DB first, so it must drain buffered request details before closing; the buffer repo registers its own handler, which would run too late. Likewise `sqljsAdapter` flushes accepted runtime events before the final export, because their writes mark sql.js dirty and must be in the exported image, and `thoughtSignatureStore` has a synchronous drain (`flushPendingSignaturesSync`) because its unref'd 1s timer may never fire at shutdown.

**Where:** `src/lib/db/adapters/betterSqliteAdapter.js`: shutdown handler; `src/lib/db/adapters/sqljsAdapter.js`: close/flush; `open-sse/services/thoughtSignatureStore.js`: `flushPendingSignaturesSync`

### D6. Module-level state is anchored on globalThis (Next bundling and HMR)

Next bundles a module once per route/entry, so plain module state is not shared, and dev hot reload resets module state. The db driver state, the request-details queue (so a shutdown flush sees rows from request handlers), the bootstrap init guard, `initializeApp` state and the `quotaAutoPing` scheduler (one per server process) all live on `globalThis`. This stops double initialization and lost buffers.

**Where:** `src/lib/db/driver.js`; `src/lib/db/repos/requestDetailsRepo.js`; `src/shared/services/bootstrap.js`; `src/shared/services/initializeApp.js`; `src/shared/services/quotaAutoPing.js`

### D7. WAL maintenance uses passive checkpoints; TRUNCATE only at close/backup

The better-sqlite3 and node:sqlite adapters run periodic PASSIVE checkpoints to keep the WAL bounded without stalling the request-serving process. TRUNCATE checkpoints are reserved for shutdown and backup.

**Where:** `src/lib/db/adapters/betterSqliteAdapter.js`; `src/lib/db/adapters/nodeSqliteAdapter.js`

### D8. sql.js persistence: max-wait, atomic write, cache drop, retry

sql.js is in-memory, so the adapter saves by exporting. A pure debounce would postpone the save forever under steady writes, so a maximum wait applies. The save writes a sibling tmp file then renames it over the target. `export()` frees every prepared statement, so the prepared-statement cache is dropped afterwards. On save failure `dirty` stays true and a retry is scheduled; without it the data would sit unsaved until the next write.

**Where:** `src/lib/db/adapters/sqljsAdapter.js`: `scheduleSave`, `saveNow`, `persist`

### D9. Dynamic import of better-sqlite3 outside the driver

The cursor auto-import route uses a dynamic import for the same reason the DB driver does: the route stays importable when the native binding is missing, and ESM callers (tests, bundlers) get a real module instead of a bare `require`.

**Where:** `src/app/api/oauth/cursor/auto-import/route.js`

### D10. Schema: bump SCHEMA_VERSION; TABLES is additive only

`TABLES` in `schema.js` is the declarative current schema, used by `syncSchemaFromTables` to auto-add missing tables, columns and indexes. SCHEMA_VERSION must be bumped by +1 on every schema change because it triggers the one-time pre-change safety backup in `migrate.js` (forgetting only skips the backup, it does not break additive sync). Destructive changes (drop, rename, type change) need a versioned migration file. SQLite only allows PRIMARY KEY/UNIQUE at create time, so `syncSchemaFromTables` strips them from columns added with ADD COLUMN. DB freshness is captured before migrations stamp `_meta`, otherwise a brand-new DB would be misclassified as non-fresh once schemaVersion is written.

**Where:** `src/lib/db/schema.js`: `SCHEMA_VERSION`, `TABLES`; `src/lib/db/migrate.js`: `syncSchemaFromTables`, `isFreshDb`, `runMigrationOnce`

### D11. Legacy db.json import is guarded and transactional

A `.migrated-from-json` marker file prevents re-importing legacy JSON when the user wipes `data.sqlite`. The import asserts row counts; on mismatch an error is thrown, the outer transaction rolls back, the legacy `db.json` stays intact, and no marker is written, so the next boot retries.

**Where:** `src/lib/db/migrate.js`: `MIGRATED_MARKER`, `importWithAssertion`

### D12. Backups are a best-effort pre-migration net and omit requestDetails

Backups are taken only before schema migrations, and there is no automated restore path (recovery is copying a file back). They intentionally exclude the `requestDetails` observability table (auto-pruned, non-critical) so a multi-hundred-MB DB backs up as a few MB. Import restores backups with no per-key `access` (older versions) as unrestricted and refuses a malformed `access`.

**Where:** `src/lib/db/backup.js`: `backupDbLite`; `src/lib/db/index.js`: backup import

### D13. Data directory ignores Unix absolute paths on Windows

On Windows, a Unix-style absolute DATA_DIR (e.g. /var/lib/...) coming from a Linux-targeted .env or Docker config is not valid and is ignored.

**Where:** `src/lib/dataDir.js`: `getDataDir`

### D14. Redis RESP replies are serialized per socket only

RESP replies on one socket are ordered, so the Redis client serializes only within a socket (lane), not across the whole client; other lanes stay concurrent.

**Where:** `src/lib/redis.js`

### D15. The bun:sqlite adapter finalizes cached statements before close

The adapter caches prepared statements and must finalize every one before `close(true)`. Otherwise Windows keeps the database file locked and removing it fails with EBUSY.

**Where:** `src/lib/db/adapters/bunSqliteAdapter.js`

## Consequences

- Removing the NUL sanitizer, or binding raw strings in a new code path, aborts flush workers on better-sqlite3 and silently truncates data on node:sqlite.
- Loading better-sqlite3 on Node 24+ crashes the process with SIGSEGV that no try/catch can catch.
- Bumping the Redis version inside the transaction, or writing via raw SQL without dropping caches, serves stale connections, aliases or routing after edits and restores.
- Closing the DB before draining buffers, or letting sql.js saves stay debounce-only or non-atomic, loses recent writes or corrupts the file.
- Forgetting SCHEMA_VERSION skips the safety backup; using TABLES for destructive changes does nothing.
- Module-level state without globalThis causes duplicate schedulers and queues that a shutdown flush cannot see.
