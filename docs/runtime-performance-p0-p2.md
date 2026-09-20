# LiteRouter Runtime Performance & Repository Cleanliness PRD

Status: Implementation PR
Target branch: `main`
Scope: P0–P2 runtime performance, concurrency, memory/CPU efficiency, and repository cleanliness
Non-goals: changing public inference contracts, removing retained providers, changing /usage or /quota behavior, removing Combo, RTK, Caveman, or Ponytail

## 1. Product invariants

The implementation MUST preserve:

- OpenAI Chat Completions: `/v1/chat/completions`
- OpenAI Responses: `/v1/responses`
- Anthropic Messages: `/v1/messages`
- native passthrough whenever the selected upstream supports the inbound transport
- translation only when native transport is unavailable
- multi-provider and multi-account
- provider/account round-robin
- Combo ordered fallback, round-robin, and automatic fallback
- quota-aware routing
- RTK, Caveman, and Ponytail
- existing `/dashboard/usage` behavior, charts, filters, and retained history
- existing `/dashboard/quota` behavior
- provider/account management UI and API keys
- current Generic Provider behavior and custom provider nodes

Normal steady-state inference should be memory-first. SQLite and Redis remain durability/coordination services, not mandatory synchronous lookups for every successful request.

## 2. Success criteria

### Concurrency

- account selection for unrelated providers must not share one global mutex
- normal round-robin selection must not synchronously persist cursor state
- Redis cache/coordination commands must not be globally serialized onto one request queue
- inference hot path must not require a SQLite write merely to advance round-robin state

### CPU

- reduce repeated JSON parse/stringify and SQLite transactions caused by per-request runtime state updates
- batch Usage persistence without changing Usage semantics
- avoid loading/instantiating specialized provider executors until used
- reduce successful-request logging work by allowing a lean production log mode

### Memory

- centralize runtime configuration snapshots instead of separate unbounded/duplicated caches
- lower SQLite page-cache target for the LiteRouter workload
- remove runtime dependencies and code paths no longer reachable in the retained product
- keep large optional tooling out of the runtime image where safe

### Repository cleanliness

- LiteRouter naming must replace stale 9Router package/image metadata where it is not a compatibility contract
- deleted product surfaces must not leave dead runtime dependencies
- no new subsystem may be introduced solely for benchmark convenience

## 3. P0 — remove hot-path serialization

### P0.1 Provider-local runtime round-robin state

Current problem:
- account selection uses one process-global promise mutex
- round-robin updates `lastUsedAt` and `consecutiveUseCount` through the durable connection repository
- the write invalidates the whole connection cache and bumps the Redis connection-cache version

Required implementation:
- replace the global mutex with synchronous process-local runtime state keyed by provider
- keep round-robin cursor and sticky-use count in memory
- selection itself must not await a mutex
- durable connection rows remain configuration/auth/health state, not per-request cursor state
- UI-visible last-use information may come from Usage or an asynchronously coalesced durability update; it must not invalidate config caches for every request

### P0.2 Redis concurrent command lanes

Current problem:
- one socket and one global promise chain serialize every Redis command

Required implementation:
- use a small configurable connection pool without adding a heavyweight runtime dependency
- each lane keeps RESP request/reply ordering
- commands distribute across lanes
- connection establishment is lazy
- failures remain fail-open for cache/invalidation use cases
- default pool size should remain small enough for a single-server deployment

### P0.3 Usage write batching

Current problem:
- each completed request performs a synchronous SQLite transaction containing dedup, history insert, daily JSON aggregation, and lifetime counter update

Required implementation:
- enqueue usage events into a bounded in-process queue
- flush in batches by size or short interval
- execute one SQLite transaction per batch
- preserve Usage history, daily aggregates, lifetime count, recent request ring, and update events
- provide explicit flush for shutdown/tests
- define overflow behavior; no unbounded memory growth
- keep the existing dashboard contract unchanged

## 4. P1 — make routing memory-first

### P1.1 Runtime snapshot/caches

The following must be served from bounded process-local snapshots after warmup:

- settings
- API keys
- provider connections
- provider nodes
- combos
- model aliases
- proxy pools when configured

Mutations invalidate/update the relevant local snapshot. Redis version/invalidation remains available for future multi-replica use, but a single-instance happy path should not ask Redis every request.

### P1.2 Combo/model lookup

- `getComboByName` must use the combo snapshot
- provider-node prefix resolution must use a provider-node snapshot
- alias resolution must use an alias snapshot
- proxy pool resolution must use a proxy-pool snapshot
- snapshot reads return cloned/immutable-safe values where callers may mutate them

### P1.3 Lazy specialized executors

Current problem:
- executor registry statically imports and eagerly instantiates all specialized executors

Required implementation:
- retain DefaultExecutor for normal API-key compatible providers
- specialized executors load dynamically on first use
- cache loaded instances
- hidden/unused providers must not instantiate at boot
- callers await executor resolution
- do not change provider behavior or transport translation

### P1.4 Remove barrel side-effect loading

- do not import the full `open-sse/index.js` solely to install proxy-aware fetch
- import the required side effect directly from process/request bootstrap
- route modules should import only the modules they use

## 5. P2 — CPU/RAM and cleanliness

### P2.1 SQLite tuning

Benchmark-oriented defaults for LiteRouter:

- WAL remains enabled
- `synchronous=NORMAL` remains
- reduce page cache target from ~64 MiB to ~16 MiB unless overridden
- use WAL auto-checkpoint
- periodic maintenance checkpoint should be PASSIVE, not TRUNCATE
- TRUNCATE remains acceptable for shutdown/backup/maintenance
- keep a finite busy timeout

### P2.2 Logging

- keep warnings/errors and actionable provider/auth diagnostics
- make successful request INFO logging optional in production
- avoid formatting/capturing verbose success logs when log level excludes them
- console dashboard remains functional for retained logs

### P2.3 Runtime/dependency cleanup

Candidates must be traced before deletion. Expected cleanup includes:

- stale package metadata naming
- stale Docker image label
- Monaco dependencies after translator UI deletion
- old CLI-only dependencies not consumed by the retained server
- hidden PXPipe/headroom/fusion/capacity-adapter code only if proven outside the retained product contract; do not delete by directory name alone

Provider support is retained. Registry metadata may remain static if small; heavy executors should be lazy.

### P2.4 CI performance guardrails

Add a deterministic concurrency test that does not require live providers:

- many simultaneous account selections across at least two providers
- verify unrelated provider selection does not serialize
- verify round-robin does not invoke durable writes
- verify Redis pool can have more than one command lane in flight
- verify Usage queue remains bounded and drains

Retain the existing test suite.

## 6. Architecture after implementation

```text
request
  |
  +--> settings/API key/model/combo/provider/account snapshots (memory)
  |
  +--> provider-local RR/cooldown runtime state
  |
  +--> lazy provider executor
  |
  '--> upstream

side paths:
  Usage event --> bounded queue --> batched SQLite transaction
  config mutation --> SQLite --> local invalidation/update
  Redis --> TTL/coordination/invalidation, not mandatory per happy-path request
```

## 7. Rollout and compatibility

- implementation lands through PR to `main`
- schema changes, if any, must use the existing migration/version mechanism
- production configuration and durable Usage history must remain loadable without manual edits
- no change to the public endpoint paths or response formats
- no change to current `/usage` and `/quota` product behavior

## 8. Verification checklist

Before merge:

- unit suite passes
- three ingress transport tests pass
- Combo fallback and round-robin tests pass
- account fallback tests pass
- Usage and Quota tests pass
- OAuth/token refresh tests pass
- new concurrency/runtime-state tests pass
- image builds successfully
- no retained UI route imports deleted dependencies
- PR review findings are addressed or explicitly documented
