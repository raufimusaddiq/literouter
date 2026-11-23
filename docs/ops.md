# Operations

How LiteRouter runs in production and how to ship, check and roll back a release. The host address is deliberately not recorded here; use the production host from your own notes.

## Topology

```text
clients -> Cloudflare -> Caddy (https://ai.musaddiqr.com) -> literouter container (loopback / idx-edge network)
                                                              |
                                                       9router-data volume (SQLite, WAL) + Redis cache
```

- One container, `literouter`, defined in `compose.production.yml` and run from the host tree at `/home/ubuntu/9router`.
- State is the `9router-data` volume mounted at `/app/data` (`bun:sqlite`, one writer). Never mount it in a second container while `literouter` runs.
- Redis (`idx-redis`, prefix `literouter:prod:`) is a cache only, never the source of providers, keys, usage or settings.
- The image is the Bun image, with no `node`. The compose healthcheck runs the app binary with `BUN_BE_BUN`.
- Secrets and env live in `.env.production` on the host (`JWT_SECRET`, `API_KEY_SECRET`, `MACHINE_ID_SALT`, `INITIAL_PASSWORD`); see `.env.example`.

## Release path

1. A PR merges into `main` after CI and the required Hermes review are green.
2. Every `main` commit runs `.github/workflows/production-image.yml`, which publishes `ghcr.io/raufimusaddiq/literouter-production:production-<full-sha>`. Tags are immutable; never deploy `latest`. `staging` is only an integration branch and is never deployed.
3. Wait for that workflow to finish (`gh run watch`); the tag does not exist before then.

## Deploy

Run on the production host, in this order. The host tree supplies `compose.production.yml` and the scripts, so it must move first.

1. Pre-flight, read-only: `df -h /` (keep at least 5 GB free), `docker ps`, `git -C /home/ubuntu/9router status --short` (must be empty).
2. Note the running tag: `docker container inspect literouter --format '{{.Config.Image}}'`.
3. Check out the release in the host tree before deploying:
   ```bash
   git -C /home/ubuntu/9router fetch origin
   git -C /home/ubuntu/9router checkout <full-sha>
   ```
   Clear a dirty tree by diffing against `main`, never with `git reset --hard`, `git clean -f` or `git stash`.
4. `bash /home/ubuntu/9router/scripts/deploy.sh <full-sha>`.

`deploy.sh` takes only a 40-hex main sha. It reads the replaced tag from the live container and aborts if the container is missing, is not on this repository's image, or is not on a full-SHA `production-` tag. It pulls the published image (the host never builds), runs `docker compose -f compose.production.yml up -d --no-build --wait` for the single `literouter` container (`LITEROUTER_WAIT_TIMEOUT` sets the budget, default 300 s), then requires the container to report `healthy` and `https://ai.musaddiqr.com/api/health` to answer. Only then does it remove the tag it replaced. If any check fails the old tag stays, so the deploy can be rolled back. If the pull is denied, log in to GHCR once with `gh auth token | docker login ghcr.io -u raufimusaddiq --password-stdin`.

Expect a few seconds of 502 at the edge during the swap: the old writer must stop before the new one starts.

## Post-deploy checks

Within 15 minutes:

- `https://ai.musaddiqr.com/api/health` returns 200; keyless `/v1/models` returns 401; `/login` returns 200.
- A local-only path such as `/api/oauth/cursor/auto-import` answers 403 from the public side.
- One authenticated non-stream chat and one stream chat, the stream ending with exactly one `data: [DONE]`.
- `docker logs literouter` shows `[DB] Driver: bun:sqlite` and `[Redis] connected`, with no errors; `docker stats literouter` shows RSS well under the 768 MiB limit.
- Usage counters increase; dashboard login works through Cloudflare.
- `PRAGMA integrity_check` returns `ok` from a read-only sibling container.

## Rollback

Nothing rolls back automatically; the decision is human. Triggers: an unhealthy container, sustained `/v1` 5xx, a data-integrity failure.

1. Check out an earlier `main` sha that has a published image in the host tree: `git -C /home/ubuntu/9router checkout <earlier-sha>`. This restores the Bun compose and `deploy.sh` of that release.
2. `bash /home/ubuntu/9router/scripts/deploy.sh <earlier-sha>`. It uses the local image or pulls it from GHCR.

Rolling back to the Node release (`a6c24a6d66a8d692d43c1e38173b8887813f6810`) is no longer possible. Migrations in `src/lib/db/migrations/` are forward-only and run when the new container starts, so after a release that applied one, fix forward with a new commit instead of redeploying an older image.

## Backup

Take a copy with `VACUUM INTO` from a read-only connection to `/app/data/db/data.sqlite`, then open it, run `PRAGMA integrity_check` and compare table counts. A backup is for disaster recovery only. Never restore one over the live `9router-data` volume unless `integrity_check` on the live database fails: it discards data written since the backup and can leave schema and code out of step.

## Host rules

The host is shared with other apps.

- Touch only the `literouter` container, its image tags and the `9router-data` volume. Never run `docker system prune`, and never remove `production-*` tags other than through `deploy.sh`.
- No builds, installs or local test runs on the host; CI builds and tests, the host only pulls.
- Reclaim a worktree or branch only after `git merge-base --is-ancestor <branch> origin/main` succeeds and nothing is left unmerged.
- Request-log retention is `OBSERVABILITY_MAX_RECORDS` rows (compose default 15000, override `LITEROUTER_OBSERVABILITY_MAX_RECORDS`). The memory ceiling is the container `mem_limit`.
