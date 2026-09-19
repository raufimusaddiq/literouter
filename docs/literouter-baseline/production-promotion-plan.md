# LiteRouter production promotion plan

Status: **planning only**. Do not merge `staging` into `main` or run the
current production deploy script until Phase 1 is complete.

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

Redis is a cache and invalidation bus, not LiteRouter's durable database.
Adding `REDIS_URL` does **not** make two SQLite replicas safe.

SQLite can serve one active writer safely. Therefore the present architecture
can support a tested replacement with a short write outage, but cannot prove
both zero data loss and zero public downtime. A shared durable database is
still required for the *temporary* old/new overlap during cutover, even though
the final production topology has one LiteRouter instance.

## Target architecture

```text
clients
  |
Caddy (ai.investdx.biz.id)
  |
LiteRouter
  |
shared durable DB + Redis cache
```

- Durable DB: a supported networked transactional database, backed up and
  reachable from the temporary old/new cutover pair. SQLite remains only for
  local development and staging until its replacement has passed migration and
  rollback rehearsal.
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

Phase 1 alone does **not** satisfy zero downtime. It only
makes the production image and cache configuration explicit and reproducible.

### Phase 2 — shared durable state

Implement and rehearse the database migration before the production promotion:

1. Add one network database adapter; keep the current repository API so route
   code does not gain database branches.
2. Build an idempotent import from a SQLite snapshot. Include provider
   connections, API keys, settings, aliases, combos, usage, request details,
   proxy pools, pricing, and migration metadata. Count every table before and
   after import.
3. Add schema migration/version checks and a write-fence mode. During the final
   sync the old writer must either reject mutations clearly or queue them in
   the durable target; it must not accept writes that are silently missed.
4. Rehearse: snapshot, import, final sync, application boot from the target,
   route a real provider request, mutate dashboard state on A, observe it on
   B, then restore the prior image and data from a verified backup.
5. Keep an immutable pre-promotion SQLite backup plus a verified restore
   command. Do not call a backup successful until it opens and table counts
   match the source.

Acceptance: 9Router and the candidate LiteRouter pass requests concurrently
against the durable target during the rehearsed cutover; a provider or settings
mutation is visible to LiteRouter within the documented cache-invalidation
bound; final LiteRouter has no writable SQLite production volume.

### Phase 3 — zero-downtime promotion

After Phase 2 passes on staging, create the release PR `staging -> main`.
Require CI, Hermes approval, clean merge state, an immutable image digest, and
the full promotion-gates suite on the exact merge SHA.

Cutover procedure:

1. Record image digest, DB backup ID, table counts, Redis `PING`, current
   Caddy/load-balancer configuration, and the rollback image.
2. Deploy LiteRouter A with the production secret set, shared durable DB, and
   `literouter:prod:` Redis prefix. Keep it out of public traffic. Require
   health, authenticated dashboard, `/v1/models`, Kenari Chat/Responses,
   OpenCode Go Chat/Responses, and one streaming request with exactly one
   `[DONE]` sentinel.
3. Add A as a healthy backend, then drain 9Router. Existing streams finish;
   new requests go to A. Verify public `ai.investdx.biz.id` continuously during
   the drain.
4. Keep only LiteRouter A after the observation window. Stop and retain the
   prior 9Router container/image plus the database backup for rollback.
5. Roll back by draining LiteRouter backends and restoring the known-good
   service only if the target database schema remains compatible. For an
   incompatible migration, restore the verified database backup first; never
   point the old image at an unknown schema.

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
- [ ] Candidate and old service use the shared durable target during the
      cutover; final LiteRouter has no writable SQLite volume.
- [ ] Candidate passes provider, streaming, UI mutation, and public-endpoint
      smoke checks.
- [ ] Drain/cutover has no failed public probe or abandoned stream.
- [ ] Rollback image and database restore are rehearsed against the release.
- [ ] Upstream intake timer creates review PRs only and removes its workspace.
