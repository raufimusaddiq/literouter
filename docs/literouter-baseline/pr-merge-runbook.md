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
This box only pulls, never builds:

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
