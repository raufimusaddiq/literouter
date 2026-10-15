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
(`ExecStart=/opt/9router/scripts/...`), and `scripts/upstream-intake.sh` defaults
`REPO=/opt/9router`, so the daily intake timer operates on that same tree. A
stale tree silently installs old unit files and runs old scripts. Reclaiming
merged worktrees early is safe because the deploy pulls the immutable image by
tag and does not need them.

**1. The host tree must be on the merged main SHA.**

```bash
git -C /opt/9router rev-parse HEAD      # must equal the merged main SHA being deployed
git -C /opt/9router status --short      # list every dirty and untracked path
```

If HEAD differs, the tree is stale. Clear the blockers by diffing, never by
discarding:

```bash
git -C /opt/9router diff origin-literouter/main -- <path>   # per modified file
```

Discard a modified file only when its content is already on `main`, or the owner
has explicitly said `main` is canonical. Untracked runtime output directories
(for example `docs/literouter-baseline/intake/`, which `main` does not track) are
left alone. Never `git reset --hard`, never `git clean -f`, never `git stash`
away someone else's work. A modified file whose content already equals `main`
still blocks checkout — `git checkout` refuses on any content difference from
HEAD — so revert it explicitly. Then:

```bash
git -C /opt/9router fetch origin-literouter main
git -C /opt/9router checkout <merged-main-sha>
```

**2. Reclaim merged worktrees and their branches.** LiteRouter worktrees live in
`/home/ubuntu/worktrees`. Remove a worktree or branch only after proving it is
fully merged:

```bash
git -C /opt/9router merge-base --is-ancestor <branch> origin-literouter/main   # must succeed
git -C /opt/9router rev-list --count origin-literouter/main..<branch>          # must be 0
```

If either check fails, keep it and report. Then:

```bash
git -C /opt/9router worktree remove /home/ubuntu/worktrees/<short-description>
git -C /opt/9router branch -d <feature-branch>
git -C /opt/9router worktree prune
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
git -C /opt/9router worktree list
```

If reclaim is incomplete or ownership is uncertain, stop and report the
remaining reclaimable usage instead of proceeding.

Deploy by pulling the published image — this box only pulls, never builds:

```bash
cd /opt/9router
LITEROUTER_PRODUCTION_TAG=production-<full-sha> \
  docker compose -f compose.production.yml up -d --no-build
```

Wait for the workflow (`gh run watch --repo raufimusaddiq/literouter`) to reach
`completed success` for the merged SHA before pulling; the tag is immutable, so
never deploy `latest`. Then require `docker inspect` healthy with the expected
image tag and smoke `https://ai.investdx.biz.id/api/health`.

If a pull ever fails with `denied`, the GHCR package is private: log in once with
`gh auth token | docker login ghcr.io -u raufimusaddiq --password-stdin`, or flip
the package to public in the repo's package settings. A public repo's package
normally inherits public visibility, but the package does not exist until the
workflow has run once.

No local build, so no `docker builder prune` needed. Builds no longer touch this
box's RAM or disk.

### Production image retention

**N=2**: keep the running `production-<full-sha>` tag and the immediately
previous deployed tag for rollback. Follow the richmod `infra/deploy/post-deploy.sh`
pattern: record the previous release before deploying; explicitly keep both
release tags. Do not infer the previous release from image creation time (a
rollback may run an older build). Run `scripts/post-deploy.sh` after every
successful, healthy deployment as a separate host-side operator step. The
production image build/push workflow and deploy controller are unchanged;
this step is not automatically enabled by merging the PR.

#### Automatic retention timer (recurrence prevention)

`scripts/post-deploy.sh` stays the single pruning implementation; nothing else
duplicates it. Because the production deploy path is a manual `docker compose`
sequence with no scripted hook (and `scripts/deploy-9router.sh` is banned from
it), retention is driven by a systemd timer instead of a CI→host channel:

| File | Role |
| --- | --- |
| `scripts/image-retention.sh` | Derives the two tags and calls `post-deploy.sh` |
| `scripts/image-retention.service` | `oneshot`, runs the wrapper |
| `scripts/image-retention.timer` | `OnCalendar=hourly`, `Persistent=true` |
| `scripts/image-retention.env` | Optional overrides; deletion is off unless uncommented |

Install on the host (this repository's scripts directory is the install path,
matching the other units):

```bash
sudo install -d -o ubuntu -g ubuntu -m 0755 /var/tmp/9router-image-retention
sudo install -m 0644 /opt/9router/scripts/image-retention.service \
                      /opt/9router/scripts/image-retention.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now image-retention.timer
```

The first `install -d` is **required**, not optional: systemd opens
`StandardOutput=append:` before it runs `ExecStartPre`, so the `mkdir` in that
directive never executes and the unit fails at start with
`Failed to set up standard output: No such file or directory`
(`status=209/STDOUT`). Creating the directory in the install steps is what makes
the documented append target exist. Verify one cycle is a manifest:

```bash
sudo systemctl start image-retention.service
cat /var/tmp/9router-image-retention/retention.log
```

The timer runs hourly: a deploy adds one 1.35GB tag, so an hourly reconcile
bounds dead space to at most one stale image between deploys without holding a
lock on the deploy path. The service is a handful of read-only `docker inspect`
calls plus one manifest. This supersedes the manual `post-deploy.sh` step **for
recurrence prevention** — an operator no longer has to remember it. The
historical-cleanup boundary below is unchanged and still requires its own
approval.

The unit runs as `ubuntu`, so it logs to
`/var/tmp/9router-image-retention/retention.log` rather than `/var/log` (which is
root-owned and would fail the unit at start before `ExecStart`, leaving the timer
silently pruning nothing). The install steps above create that directory; the
unit's `ExecStartPre` cannot be relied on for it, because systemd sets up
`StandardOutput=` before `ExecStartPre` runs. The log file is opened by systemd as
root before privileges drop, so it stays root-owned while the state file next to
it is `ubuntu`-owned.

Both tags come from the live container, never from image age. The wrapper reads
the running `production-<full-sha>` tag with a read-only
`docker container inspect literouter`, and the rollback tag is the tag the unit
last observed running, kept in
`/var/tmp/9router-image-retention/state` (`current=`, `previous=`). A rollback
therefore reads as a deploy: the tag it replaces becomes the rollback tag. An
unreadable, unhealthy, stopped, or unexpected container aborts before any
pruning, and `post-deploy.sh`'s container-reference protections are unchanged,
so a rollback image still referenced by a container is never removed regardless
of what the state file records.

**The scheduled run is a read-only manifest.** Deletion requires an explicit,
separately approved change: uncomment `LITEROUTER_APPLY=true` in
`scripts/image-retention.env` (or set it in the unit), then
`sudo systemctl restart image-retention.timer` and confirm one manifest-only
cycle first. First-run removal of already accumulated images is the historical
cleanup described below and needs its own approval, independent of enabling the
timer.

Required operator environment (neither variable has a default):

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

`tests/unit/image-retention.test.js` covers the timer wrapper the same way —
synthetic `docker`/`curl` on `PATH`, never a real container, image or tag — and
verifies that the running tag comes from the live container rather than image
age, that a rollback is treated as a deploy, that the rollback tag survives
successive deploys, that the scheduled run deletes nothing, that deletion
happens only under the approved flag, and that an unhealthy, stopped, foreign,
wrong-tag or corrupt-state input aborts without removing anything.

### Intake workspace retention

Intake clones live in `$UPSTREAM_INTAKE_DIR/worktree.*` (default
`/var/tmp/9router-upstream-intake`). `scripts/upstream-intake-retention.sh` decides
what may be deleted; it never reads a clone with a work tree or its hooks/config.

| Situation | Outcome |
|---|---|
| Failed run, clone holds nothing unpublished (detached at an upstream commit, or every branch merged/published with no open PR, clean) | removed at exit |
| Failed run with unpushed commits, dirty/untracked edits, unknown refs, or unverifiable state | retained |
| Successful review-only run with an open PR | retained |
| Startup GC, clone idle >= `UPSTREAM_INTAKE_RETAIN_DAYS` (default 14, min 2) and all work merged into `origin-literouter/main`, or published on `origin-literouter` with no open PR, or upstream-only | removed |
| Anything else (recent, open PR, unpublished, dirty, symlink, unknown ref, GitHub/Git error) | kept; reason logged |

GC is bounded per run (`UPSTREAM_INTAKE_GC_SCAN_MAX` oldest candidates, default 50;
`UPSTREAM_INTAKE_GC_DELETE_MAX` removals, default 5), takes `.gc.lock` in the work
root, and skips the run's own clone. Never compare against `origin/main`: `origin`
is upstream `decolua/9router`; published/merged evidence comes only from
`origin-literouter`.

Tags, remote-tracking refs, and every commit named in a reflog must already exist in
the host repo (reachable from a host ref); otherwise the clone is kept, so a tag or
rewritten work can never hold the only copy of a commit. Before enabling the GC on a
host with retained clones, list candidates read-only (no fetch, no removal) and get
deletion approved:

```bash
( . scripts/upstream-intake-retention.sh; log() { echo "$*"; }; REPO=/opt/9router REMOTE=origin \
  TARGET=origin-literouter BASE_BRANCH=main LOG_PREFIX=manifest \
  WORK_ROOT=/var/tmp/9router-upstream-intake retention_manifest )
```
