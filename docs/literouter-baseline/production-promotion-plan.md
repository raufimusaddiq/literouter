# LiteRouter production promotion plan

Status: **Phase 1 complete, Phase 2 revised**. `staging` is the promotion
source; Phase 3 is the release PR (`staging -> main`) followed by the rehearsed
cutover. HA remains out of scope.

Revision (2026-09-20): Phase 2 originally required a networked durable
database. That requirement is withdrawn, not deferred — see
“Why the shared-database gate is withdrawn” below. The constraint it existed to
protect (never two writers on one SQLite file) is enforced by sequencing
instead.

`main` is this repository's default branch. References to “master” below mean
`main`. The target is one LiteRouter production instance; HA is out of scope.

## Current facts — 2026-09-20

- `ai.investdx.biz.id` reaches container `9router` at `172.30.0.2:20128`.
- Production state is the writable Docker volume `9router-data`; its SQLite
  database is WAL-mode and is actively accompanied by `data.sqlite-wal` and
  `data.sqlite-shm`.
- `idx-redis` is healthy and persistent (AOF enabled), but only staging sets
  `REDIS_URL`. Redis currently contains cache-version keys only.
- LiteRouter staging passes the recorded promotion gates. It uses its own
  volume and the `literouter:staging:` Redis prefix.
- `scripts/deploy-9router.sh` must not be used for promotion: it starts
  `9router-green` against the live `9router-data` volume while `9router` is
  still running. That creates concurrent SQLite writers, so neither a
  zero-loss nor a zero-downtime claim is valid.

## Non-negotiable constraint

SQLite can serve exactly one active writer, so at no point may the old and new
containers mount `9router-data` at the same time. Redis is a cache and
invalidation bus, never the source of providers, keys, usage, settings, or
sessions.

## Why the shared-database gate is withdrawn

The original Phase 2 assumed a two-backend overlap: 9Router and LiteRouter both
serving live traffic against a shared durable target. That overlap is not
needed to satisfy this objective, and paying for it would mean adopting a
network database purely to serve a transition measured in seconds.

Evidence that one writer at a time is already safe, both recorded against a
**copy** of `9router-data` rather than the live volume:

- `phase-minimal-boundary.md` — the current staging image with
  `MINIMAL_PROFILE=true` reads that copy (`providers: 3 combos: 4 keys: 5
  usage: 40956`) and reports `health: {"ok":true}`.
- `phase-rollback-rehearsal.md` — the *prior* production image boots from the
  same copy with no schema error and reads its provider and usage tables, so a
  rollback needs no schema downgrade.

Not recorded anywhere yet, and therefore required by Phase 2 below: a candidate
boot from that copy that serves `/v1/models`, completes one real provider call,
and streams one SSE response.
- SQLite's WAL is durable; a container that is stopped and replaced cannot
  leave a half-written transaction for the successor.

The cost this buys is a short write outage during the container swap, and only
that. See “Cutover procedure” for the exact window.

Out of scope, by the objective itself: HA, multi-replica service, and any
replacement of SQLite as LiteRouter's durable store while it runs as a single
instance.

## Target architecture

```text
clients
  |
Caddy (ai.investdx.biz.id)
  |
LiteRouter
  |
SQLite on `9router-data` (single writer) + Redis cache
```

- Durable DB: the existing `9router-data` SQLite volume, mounted by exactly one
  container at a time. It is backed up and counted before every swap, and the
  prior image is kept as the rollback target.
- Redis: `idx-redis` initially serves connection-cache invalidation only,
  using `literouter:prod:`. It is never the source of providers, API keys,
  usage, settings, or sessions. Its existing AOF is fine but not a durability
  dependency for LiteRouter.
- Secrets and non-DB files: `JWT_SECRET`, `API_KEY_SECRET`, `MACHINE_ID_SALT`,
  and any required `/app/data` credentials must be supplied identically to
  every production replica through the deployment secret store. Do not share a
  writable Docker volume between replicas.
- Public edge: Caddy keeps the existing hostname and client API contract.
  During cutover it temporarily routes only new requests to the healthy
  LiteRouter while existing 9Router streams drain; after the observation window
  9Router is stopped and staging is sunset.

## Required PR sequence

### Phase 1 — production foundation

Open a PR from `staging` to `main` only after these changes are separately
reviewed on staging:

1. Add a production image workflow on every `main` commit. Publish an
   immutable tag containing the full commit SHA; never deploy `latest`.
2. Replace the production compose image with that immutable LiteRouter tag.
   Preserve the current `9router-data` volume only for the one-writer
   compatibility deployment; do not mount it into a standby container.
3. Add `REDIS_URL=redis://idx-redis:6379` and
   `REDIS_KEY_PREFIX=literouter:prod:` to production compose. Verify `PING`,
   a namespaced version key, and Redis-off fallback.
4. Replace `9router-edge-guard` with a generic LiteRouter edge guard before
   changing container identity. Preserve `172.30.0.2` until in-network clients
   no longer depend on the `9router` DNS name.
5. Remove `scripts/deploy-9router.sh` from the production path. It is not an
   acceptable rollout mechanism for SQLite.

Phase 1 does not by itself change what is serving traffic. It makes the
production image and cache configuration explicit and reproducible.

### Phase 2 — run and rollback evidence

No migration is implemented. Phase 2 is the evidence that switching the single
writer is safe, and it is complete when all of the following hold against a
copy of the live `9router-data` volume:

1. Candidate image boots from the copy, serves `/api/health`, `/v1/models`,
   one non-streaming provider call, and one streaming provider call with a
   single `[DONE]` sentinel.
2. `PRAGMA integrity_check` on the copy returns `ok`, and every table's row
   count matches the source. Record one capture id; do not quote counts
   captured at different times (see `README.md`).
3. The prior production image boots from a copy of the same volume and serves
   traffic, so rollback does not require a schema downgrade.
4. An immutable pre-promotion backup exists and has been opened and counted.

Acceptance: the above, plus the Phase 3 swap executed once on staging as a
rehearsal and recorded (Caddy upstream repointed in one step, then a public
health sweep over the same endpoints). Two containers must not be serving from
`9router-data` simultaneously, so the rehearsal is a flip, not an overlap: the
sweep is expected to show failures inside the swap window and clean `200`s on
both sides of it.

Entry gate for Phase 3: the same swap has been executed once against the live
edge, including the stop of the old writer, the start of its successor, the
duration of the write window, any failed public probe, and the rollback
invocation actually used.

Status: **met on a disposable copy** — `phase-edge-swap-rehearsal.md` records
both halves: the Caddy flip on the live edge (12/12 probes reaching a router
across a one-second swap) and the stop-old-writer/start-successor/rollback
sequence against a copy of `9router-data`, including a real provider call and a
single-`[DONE]` stream. The production run is the only remaining measurement:
the write window under real traffic and the count of in-flight requests that
fail inside it.

### Phase 3 — promotion with a bounded write window

After Phase 2 passes on staging, create the release PR `staging -> main`.
Require CI, Hermes approval, clean merge state, an immutable image digest, and
the full promotion-gates suite on the exact merge SHA.

Zero *downtime* in the strict sense — no failed request at any instant — is not
what this sequence provides. It provides zero downtime for the public endpoint
except during the swap window in step 2, and zero data loss throughout.

Cutover procedure — one writer at a time, no overlap:

1. Record image digest, backup id, the capture id from `README.md`, Redis
   `PING`, the current Caddy upstream, and the rollback image.
2. Stop `9router` (the only writer) and confirm the socket closes. This is the
   write window; clients see connection failures, not corrupted data. Nothing
   else may mount `9router-data` while this container is running.
3. Start LiteRouter with the production secret set, the same `9router-data`
   volume, and the `literouter:prod:` Redis prefix. Require `/api/health`,
   authenticated dashboard, `/v1/models`, Kenari Chat/Responses, OpenCode Go
   Chat/Responses, and one streaming request with exactly one `[DONE]`.
4. Point the Caddy upstream at LiteRouter and run the public `200` sweep until
   it is clean. Keep the prior image and the verified backup retained.
5. Per the objective, staging is sunset at this point: stop `literouter-staging`
   and remove the `ai-staging.investdx.biz.id` block. Production is now the only
   LiteRouter deployment.

Rollback: stop LiteRouter, restore the verified backup if the new schema was
written, start the prior 9Router image against `9router-data`, and flip Caddy
back. Never point the old image at a database whose schema it has not been
tested against.

Known, accepted cost: step 2 is a write outage, and a request in flight at that
moment fails. Zero *data* loss is preserved because the volume is not touched
and the backup is verified; zero downtime is preserved at the edge for every
request that is not in flight during the swap.

The public endpoint, API paths, and client API keys stay unchanged.

## Release intake from upstream

Use a daily systemd timer or cron job to create a disposable review session,
not an unattended production deploy:

1. Fetch `decolua/9router` in a temporary worktree; compare it with LiteRouter
   `main` and identify commits touching retained core paths.
2. Start one disposable Codex session in that worktree. It produces a short
   change/risk report and a `git cherry-pick -x` branch targeted at `staging`.
   It may resolve conflicts and open the PR, but may not merge or deploy.
3. Run the normal staging PR gates. A passing `staging -> main` release PR is
   the only route to production.
4. On completion, delete the temporary worktree, branch checkout, session
   artifacts, and any copied credentials. The timer logs commit IDs and PR URL
   only. Confirm the installed Codex CLI's non-interactive, ephemeral-session
   command before enabling this timer; do not invent a long-lived agent token.

Cherry-pick only changes with an explicit retained-core benefit (security,
protocol compatibility, routing correctness, SQLite/DB correctness, or a
measured performance fix). Do not merge upstream wholesale: deleted tunnel,
MITM, cloud-sync, GitBook, and UI code stay deleted.

## Production-release evidence checklist

- [ ] Exact `main` SHA has green CI and Hermes approval.
- [ ] Production image digest equals that SHA; no mutable image tag used.
- [ ] Durable-state backup restores and every table count matches.
- [ ] Redis `PING` works; keys use `literouter:prod:`; Redis failure still
      routes correctly.
- [ ] Exactly one container mounts `9router-data` at every instant; the old
      writer is stopped before the new one starts.
- [ ] Candidate passes provider, streaming, UI mutation, and public-endpoint
      smoke checks.
- [ ] The public `200` sweep is continuous across the swap; no failed probe.
- [ ] Rollback image and database restore are rehearsed against the release.
- [ ] Upstream intake timer creates review PRs only and removes its workspace.
