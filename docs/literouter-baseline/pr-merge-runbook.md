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

## Merge

```bash
gh pr merge <n> --repo raufimusaddiq/literouter --merge --delete-branch=false
```

`--delete-branch=false` keeps the branch for audit; PRs here are stacked.

## `BLOCKED` with no failing check

`Hermes Review` is a required status check on `staging` (classic protection,
`strict: true`). Hermes authenticates as the `personal-code-reviewer[bot]` GitHub
App, which **can** create check runs — but the run occasionally fails to POST
(`GITHUB_POST_FAILED`, HTTP 403) and then nothing ever satisfies the gate.

Recovery: push an empty commit to the PR branch and let Hermes re-run.

```bash
git fetch origin-literouter <branch>:pr-tmp
git checkout pr-tmp
git commit --allow-empty -m 'chore: re-trigger review'
git push origin-literouter pr-tmp:<branch>
git checkout staging && git branch -D pr-tmp
```

This has worked both times it was needed (PR #4, 2026-09-19). Drop the dummy
commit before merging if the history matters; it is harmless otherwise.

## After merge

The staging image is built by `.github/workflows/staging-image.yml` on every push
to `staging` and published to
`ghcr.io/raufimusaddiq/literouter-staging:staging-<full-sha>` (+ `staging-latest`).
This box only pulls:

```bash
cd /opt/9router
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
