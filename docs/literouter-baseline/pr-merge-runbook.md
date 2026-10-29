# PR merge runbook

Merge rule (standing): **merge without asking when CI is green AND the reviewer
raises no blocker.** A 🟡 outcome with suggestions is a merge, not a hold.

## Pre-merge checklist

1. Every required check `completed:success`:
   `gh pr view <n> --repo raufimusaddiq/literouter --json statusCheckRollup`
2. Reviewer verdict is APPROVE, or REQUEST CHANGES with only non-blocking notes.
3. `mergeStateStatus` is `CLEAN`. `BLOCKED` + `MERGEABLE` means a required check
   has never reported — see below.
4. Disk has room: `df -h /` (keep ≥ 5 GB free). Builds, not the app, consume it.

## Unit tests in CI

This instance is a production host: agents must not install dependencies, build,
or run local tests, including focused suites. Add regressions, push real changes,
wait for GitHub CI. Disposable upstream agents keep their workspace until gates
pass and deployment is healthy; completed failures trigger repairs, not disposal.

`.github/workflows/test.yml` runs the vitest suite on every PR and on pushes to
`main`. It installs root deps (`next`, `undici`, `uuid`, …) plus the
runner's own lockfile, then `npx vitest run` from `tests/`.

Files named `*.live.test.js` hit real upstreams and are excluded via
`tests/vitest.config.js` — they must never gate a merge. Run one by hand with:

```bash
cd tests && npx vitest run --exclude '' unit/<name>.live.test.js
```

## Merge

```bash
gh pr merge <n> --repo raufimusaddiq/literouter --merge --delete-branch=false
```

`--delete-branch=false` keeps the branch for audit; PRs here are stacked.

## `BLOCKED` with no failing check

`Hermes Review` is required on PRs against `main` and processes PRs FIFO. Never push an
empty “re-trigger” commit while review is queued or in progress: it moves the
PR to the back of the queue and invalidates the current review. Wait for Hermes
to post its verdict. If its check fails or the feedback is stale, push only the
real fix, then wait again; do not trigger it manually.

Hermes is slow (minutes). Wait with polling so the user never has to ask for
status. Poll the verdict on the PR's current head, not the check row alone:

```bash
gh pr view <n> --repo raufimusaddiq/literouter \
  --json reviews --jq '.reviews[-1] | {state, submitted: .submittedAt}'
```

`APPROVED` on the current head clears the gate. `CHANGES_REQUESTED` on an older
head is stale — re-check the findings against the code before acting. Keep
polling until a verdict lands on the current head.

## After merge

Staging is sunset: there is no staging branch, no `compose.staging.yml`
deployment, and no `ai-staging.investdx.biz.id` block. Every merge to `main`
builds the immutable production image via `.github/workflows/production-image.yml`
and publishes `ghcr.io/raufimusaddiq/literouter-production:production-<full-sha>`.

### Host tree and worktree reclaim (before deploy)

Run this before the pull below, not after. The host tree is not a passive
checkout: it is the source the systemd units and scripts are installed from
(`ExecStart=/home/ubuntu/9router/scripts/...`). A stale tree silently installs
old unit files and runs old scripts. Reclaiming merged worktrees early is safe
because the deploy pulls the immutable image by tag and does not need them.

**Retired intake leftovers (owner approval required).** The Codex intake
controller is gone from the repo, but `/etc/systemd/system/upstream-intake.service`
and `upstream-intake.timer` may still be installed (timer disabled; the service's
`ExecStart` path no longer exists). Do not enable or start them. With owner
approval, remove them with
`sudo rm /etc/systemd/system/upstream-intake.{service,timer} && sudo systemctl daemon-reload`.
The controller's clone directory (`/var/tmp/9router-upstream-intake`) was
already absent when it was retired, so no intake clones need reclaiming. If one
ever turns up, treat it as an ordinary worktree under step 2: prove its work is
on `origin-literouter` before deleting it.

**1. The host tree must be on the merged main SHA.**

```bash
git -C /home/ubuntu/9router rev-parse HEAD      # must equal the merged main SHA being deployed
git -C /home/ubuntu/9router status --short      # list every dirty and untracked path
```

If HEAD differs, the tree is stale. Clear the blockers by diffing, never by
discarding:

```bash
git -C /home/ubuntu/9router diff origin-literouter/main -- <path>   # per modified file
```

Discard a modified file only when its content is already on `main`, or the owner
has explicitly said `main` is canonical. Untracked runtime output directories
(for example `docs/literouter-baseline/intake/`, which `main` does not track) are
left alone. Never `git reset --hard`, never `git clean -f`, never `git stash`
away someone else's work. A modified file whose content already equals `main`
still blocks checkout — `git checkout` refuses on any content difference from
HEAD — so revert it explicitly. Then:

```bash
git -C /home/ubuntu/9router fetch origin-literouter main
git -C /home/ubuntu/9router checkout <merged-main-sha>
```

**2. Reclaim merged worktrees and their branches.** LiteRouter worktrees live in
`/home/ubuntu/worktrees`. Remove a worktree or branch only after proving it is
fully merged:

```bash
git -C /home/ubuntu/9router merge-base --is-ancestor <branch> origin-literouter/main   # must succeed
git -C /home/ubuntu/9router rev-list --count origin-literouter/main..<branch>          # must be 0
```

If either check fails, keep it and report. Then:

```bash
git -C /home/ubuntu/9router worktree remove /home/ubuntu/worktrees/<short-description>
git -C /home/ubuntu/9router branch -d <feature-branch>
git -C /home/ubuntu/9router worktree prune
```

Never pass `--force` without first listing exactly what would be lost and
reporting it.

**3. Never reclaim** production containers, the running or previous
`production-*` image tag, data volumes, any env file, or anything whose ownership
is uncertain. Do not use broad `docker system prune`.

**4. Record the result before proceeding.**

```bash
df -h /
docker system df
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
git -C /home/ubuntu/9router worktree list
```

If reclaim is incomplete or ownership is uncertain, stop and report the
remaining reclaimable usage instead of proceeding.

Deploy with the script, which pulls the published image (this box only pulls,
never builds) and prunes the tag it replaced:

```bash
cd /home/ubuntu/9router
bash scripts/deploy.sh <full-sha>
```

Wait for the workflow (`gh run watch --repo raufimusaddiq/literouter`) to reach
`completed success` for the merged SHA before deploying; the tag is immutable, so
never deploy `latest`. The script itself requires `docker inspect` healthy with
the expected image tag and a successful `https://ai.investdx.biz.id/api/health`
smoke before it removes the replaced tag. See **Production image retention** for
the full behaviour and the failure path.

If a pull ever fails with `denied`, the GHCR package is private: log in once with
`gh auth token | docker login ghcr.io -u raufimusaddiq --password-stdin`, or flip
the package to public in the repo's package settings. A public repo's package
normally inherits public visibility, but the package does not exist until the
workflow has run once.

No local build, so no `docker builder prune` needed. Builds no longer touch this
box's RAM or disk.

### Production image retention

The local image store must not grow: a deploy adds one `production-<full-sha>`
tag (1.35GB uncompressed) and the tag it replaced is no longer needed. Keep the
prune in the deploy itself, where the replaced tag is known —
`scripts/deploy.sh` (below) removes exactly the tag it just replaced.

`scripts/post-deploy.sh` remains available as a manual manifest/reconcile tool
with its own N=2 safety rules. It has no automatic caller and is not part of a
routine deploy. The production image build/push workflow and the deploy
controller are unchanged.

#### Deploy with prune: `scripts/deploy.sh <full-main-sha>`

```bash
cd /home/ubuntu/9router
bash scripts/deploy.sh <full-main-sha>
```

The script is the manual deploy path, unchanged in behaviour, plus the prune:

- takes the immutable `production-<full-main-sha>` tag published by
  `.github/workflows/production-image.yml` and rejects anything else — a short
  sha, a branch, or `latest` — with a usage error before touching Docker;
- never builds locally, and never touches a tag other than the one it replaced;
- reads the tag being replaced from the live container **before** the compose up,
  and aborts rather than guess if it cannot be determined, if the container is
  not on this repository's image, or if its tag is not a full-SHA production tag;
- runs `LITEROUTER_PRODUCTION_TAG=production-<sha> docker compose
  -f compose.production.yml up -d --no-build --wait --wait-timeout 300`, which
  replaces the single `literouter` container on the `9router-data` volume, so
  SQLite keeps one writer. `--wait` is required: `up -d` alone returns while the
  healthcheck is still `starting` (30s interval/start period), which would make a
  healthy deploy look failed and skip the prune. Override the budget with
  `LITEROUTER_WAIT_TIMEOUT`;
- verifies the container reports `healthy` **and** that
  `https://ai.investdx.biz.id/api/health` answers, **before** removing anything;
- removes exactly the tag it replaced, and only when that tag differs from the
  new one.

**If any check fails the old tag stays**, so a failed deploy remains
rollback-able. A same-tag redeploy removes nothing.

Net effect: every deploy replaces one image with one image, so after N deploys
the local store holds the running tag rather than an ever-growing stack. No
timer, no state file, no wrapper, no env file, no `APPLY` flag, and no manual tag
cleanup.

#### Manual manifest: `scripts/post-deploy.sh`

`post-deploy.sh` is no longer part of a routine deploy. Use it to plan or
reconcile retention by hand, for example after an interrupted cleanup or to see
what a stricter N=2 policy would remove. Required operator environment (neither
variable has a default):

| Variable | Value |
| --- | --- |
| `LITEROUTER_PRODUCTION_TAG` | Actual running tag, `production-` plus exactly 40 lowercase hexadecimal SHA characters; not a full image reference, digest, `latest`, or PR head. |
| `LITEROUTER_PREVIOUS_PRODUCTION_TAG` | Immediately previous deployed full-SHA tag recorded before deployment, or explicit `none` when no previous release is known/available. Never guess a rollback tag or repeat the current tag to bypass a missing record. |

Unset/empty variables abort with exit 1 before Docker or health calls; the error
names the missing contract. Normal cleanup still requires both actual tags to
exist locally. If no reliable previous tag exists, explicitly skip cleanup:

```bash
LITEROUTER_PRODUCTION_TAG=production-<actual-running-full-sha> \
LITEROUTER_PREVIOUS_PRODUCTION_TAG=none \
  bash scripts/post-deploy.sh
```

`none` returns exit 0 with a skip message in both dry-run and `--apply` modes;
no Docker inspection, health request, planning, or image removal occurs. This is
**not** a successful retention manifest or proof of an available rollback image.
The current tag must still be valid. Record/retain the actual current tag before
the next separately approved deployment; it then becomes the previous tag.
Do not deploy, pull, retag, or delete anything just to satisfy this contract.

Before the deployment, record the current full image reference read-only:

```bash
docker container inspect literouter --format '{{.Config.Image}}'
```

After the new deployment passes the existing health gates, substitute the
recorded tag and the newly deployed full-SHA tag below. The default is a
**read-only manifest**, not deletion:

```bash
LITEROUTER_PRODUCTION_TAG=production-<new-full-sha> \
LITEROUTER_PREVIOUS_PRODUCTION_TAG=production-<recorded-previous-full-sha> \
  bash scripts/post-deploy.sh
```

Apply only as an approved post-deploy operation: use the same environment and
append `--apply`. First-run removal of already accumulated images is **historical
cleanup**: retain the read-only manifest and obtain separate explicit approval
before applying it. Issue #104's implementation/PR authorization does not authorize
that cleanup, and no historical tags are removed by preparing or validating it.

Safety rules:

- Only this repository's full-SHA `production-*` tags are eligible; other
  repositories, `latest`, malformed tags, volumes and build caches are untouched.
- Keep current and previous tags regardless of age/order. Also keep every tag
  referenced by **any running or stopped container**, by exact configured image
  reference or image ID (including aliases and digest-based references). These
  protections override N=2: more than two tags can remain while containers need
  them. Never remove those containers to meet the image limit.
- Both release tags must exist locally; `literouter` must be running, healthy,
  and use the expected tag **and image ID**; public `/api/health` must succeed.
  Missing/invalid configuration or failed Docker inventories abort cleanup.
  Same-tag deployments skip cleanup entirely.
- Recheck the running release and all container references before each candidate;
  recheck the candidate's ID before removal. Use exact `docker image rm <tag>`
  only, never `--force`, image-ID removal, or global prune. Removal errors stop
  further cleanup without changing the completed deployment.
- Serialize deployment, container/image mutation, and cleanup. Docker offers no
  atomic snapshot-and-untag operation; rechecks cannot protect against an
  unrelated concurrent retag/container creation after the last inspection.

Validation: `tests/unit/production-image-retention.test.js` uses synthetic
Docker/curl functions only; CI verifies successive N=2 deployments, current/
previous protection, stopped containers, aliases/digests, references added
between removals, dry-run defaults, and fail-closed errors. Do not run it on
this production host; use the PR's Test workflow per **Unit tests in CI**.

`tests/unit/deploy-script.test.js` covers `scripts/deploy.sh` the same way —
synthetic `docker`/`curl` on `PATH`, never a real container, image or tag. It
pins the dangerous regression: the replaced tag is **not** removed when the
container is unhealthy, when the public endpoint does not answer, or when the
deploy itself fails, and **is** removed on success. It also asserts the deploy
waits for health before checking it, and covers the same-tag redeploy, a missing
container, a foreign repository, a non-full-SHA tag, and the usage error for a
missing, short or malformed argument.
