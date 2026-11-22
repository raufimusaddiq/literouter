# ADR-0007: Connection records, priority and concurrency

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Provider connections (OAuth accounts and API keys) live in SQLite and are mirrored by an in-process snapshot cache in `connectionsRepo.js`. Many requests select, refresh and update connections concurrently, and the router relies on round-robin cursors, backoff counters, model locks and rotating single-use refresh tokens. Races here show up as lost tokens, stale selection state or wrong health counts. These decisions keep reads fresh and writes atomic without making large key pools expensive.

## Decisions

### D1. OAuth refresh tokens and counters merge inside the write transaction

Refresh tokens are rotated and single-use, so two concurrent writers must not overwrite each other. Updates therefore merge atomically inside a transaction. `mutateProviderConnection` runs `mutate(existing)` inside the write transaction against the stored row and returns the patch to merge (or null to skip the write). Counters such as `backoffLevel` must be derived there, not from a snapshot read earlier, otherwise concurrent failures all compute the same level. It resolves to the merged connection, or null when the row is missing or the patch was skipped.

**Where:** `src/lib/db/repos/connectionsRepo.js`: `updateProviderConnection`, `mutateProviderConnection`

### D2. The cached snapshot is updated before the first await

Round-robin selection depends on fresh rows. Updates patch the cached row synchronously before the first await, so a selection that interleaves with the async write already sees fresh state; the post-commit patch then replaces it with the stored row. A priority change renumbers sibling rows (`reorderInTx`), so only that case drops the whole snapshot, again before the first await. Every other update patches the cached row in place, which is O(1) rather than O(pool). The Redis version bump still lands after the commit.

**Where:** `src/lib/db/repos/connectionsRepo.js`: `updateProviderConnection`, `optimisticPatchCachedConnection`

### D3. Snapshot reload is single-flight with a generation check

Concurrent expiries share one `SELECT *` plus parse. A reload that started before an invalidation is never joined or committed (generation check). Callers loop until a snapshot is present, because an invalidation can land between a joined reload finishing and the caller resuming.

**Where:** `src/lib/db/repos/connectionsRepo.js`: `refreshConnectionCache`, `ensureConnectionCache`, `doRefreshConnectionCache`

### D4. Provider insert must stay bounded

POST /api/providers used to read the whole pool and renumber every row's priority inside one transaction. A 5k-key import cost O(n*m), about 25M statements, and parallel writers serialized on that transaction (issue #4311). The insert must not read the whole pool or renumber siblings: the new row takes MAX(priority)+1 so it already sorts last. An apikey name collision must not silently overwrite the stored key; it should return 409.

**Where:** `src/lib/db/repos/connectionsRepo.js`: `createProviderConnection`; `src/app/api/providers/route.js`: `POST`; `tests/unit/provider-priority-insert-cost.test.js`

### D5. OAuth identity matching never collapses distinct accounts

Codex/OpenAI can issue several OAuth grants for the same email, and the refresh tokens rotate single-use. Collapsing a new login onto an existing bare-email row overwrites the first account's token pair and makes it look invalid after a second account is added. An existing Codex row is updated only when both rows expose the same ChatGPT account ID. For non-workspace providers, rows match on email plus username so accounts from different IdPs do not overwrite each other. Username is required on both sides; if only one side has it, the identities are treated as distinct rather than falling back to bare-email matching.

**Where:** `src/lib/db/repos/connectionsRepo.js`: `createProviderConnection`

### D6. Cleared model locks are deleted, not stored as null

A cleared `modelLock_*` key is deleted from the connection. A null value still looks present to readers that enumerate `modelLock_*` keys.

**Where:** `src/lib/db/repos/connectionsRepo.js`: `pruneClearedLocks`

### D7. Connection health is exclusive buckets from one shared function

Every connection lands in exactly one bucket, so ready + attention + inactive + untested equals total. `inactive` (isActive false) always wins even if the last test failed, because a disabled connection is not routing and so does not need attention. `attention` covers active connections that are rate-limited, in cooldown (testStatus "unavailable" with a live `modelLock_*` in the future), have expired credentials, or errored; `reason` says which. `ready` is verified passing or a stale "unavailable" whose cooldown ended. `untested` is active but never tested and is not counted as ready. Overview and Providers share this single implementation.

**Where:** `src/shared/utils/connectionHealth.js`

### D8. Dual-auth providers accept API keys; creation does not overwrite

Dual-auth providers (e.g. codebuddy-cn, xai) live under category "oauth" but also accept an API key through `authModes`. They are not in APIKEY_PROVIDERS, so POST /api/providers must allow them explicitly. Edits go through /api/providers/[id]; creation must explicitly opt into overwrite.

**Where:** `src/app/api/providers/route.js`: `POST`

## Consequences

- Computing backoff or token state from a pre-read snapshot lets concurrent failures or refreshes clobber each other and invalidates accounts.
- Skipping the pre-await cache patch makes round-robin pick stale rows under interleaving.
- Renumbering or scanning the whole pool per insert brings back O(n*m) imports and serialized writers.
- Matching Codex or other OAuth rows on email alone overwrites a user's first account.
- Storing null model locks, or bucketing health differently per page, makes counts disagree and locked connections look usable.
