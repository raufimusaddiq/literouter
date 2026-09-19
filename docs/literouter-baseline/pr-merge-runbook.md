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

`.github/workflows/test.yml` runs the vitest suite on every PR and on pushes to
`staging`/`main`. It installs root deps (`next`, `undici`, `uuid`, …) plus the
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

`Hermes Review` is required on `staging` and processes PRs FIFO. Never push an
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

The staging image is built by `.github/workflows/staging-image.yml` on every push
to `staging` and published to
`ghcr.io/raufimusaddiq/literouter-staging:staging-<full-sha>` (+ `staging-latest`).
This box only pulls:

```bash
cd /opt/literouter
docker compose -f compose.staging.yml pull
docker compose -f compose.staging.yml up -d
```

Wait for the workflow (`gh run watch --repo raufimusaddiq/literouter`) before
pulling — `staging-latest` is whatever the last green run produced.

If a pull ever fails with `denied`, the GHCR package is private: log in once with
`gh auth token | docker login ghcr.io -u raufimusaddiq --password-stdin`, or flip
the package to public in the repo's package settings. A public repo's package
normally inherits public visibility, but the package does not exist until the
workflow has run once.

No local build, so no `docker builder prune` needed. Builds no longer touch this
box's RAM or disk.
