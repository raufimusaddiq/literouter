#!/usr/bin/env bash
# Daily upstream intake for LiteRouter (see docs/literouter-baseline/production-promotion-plan.md).
# Creates a disposable worktree, asks one non-interactive Codex session for a
# change/risk report + cherry-pick branch against staging, and opens a review PR.
# It never merges and never deploys. Workspace is always removed.

set -euo pipefail

REPO=/opt/9router
REMOTE=origin                 # decolua/9router (upstream master)
TARGET=origin-literouter      # raufimusaddiq/literouter
BASE_BRANCH=main
STAGING_BRANCH=staging
WORK_ROOT=${UPSTREAM_INTAKE_DIR:-/var/tmp/9router-upstream-intake}
REPORT_DIR=$REPO/docs/literouter-baseline/intake
LOG_PREFIX=upstream-intake

log() { printf '%s %s\n' "$(date -Is)" "$*"; }

cleanup() {
  if [ -n "${WORKTREE:-}" ] && [ -d "$WORKTREE" ]; then
    git -C "$REPO" worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK_ROOT" >/dev/null 2>&1 || true
}
trap cleanup EXIT

git -C "$REPO" fetch --quiet "$REMOTE" master
UPSTREAM_SHA=$(git -C "$REPO" rev-parse "$REMOTE/master")
BASE_SHA=$(git -C "$REPO" rev-parse "$TARGET/$BASE_BRANCH")

# Keep-blessed copy of upstream master so "is upstream newer?" stays checkable offline.
git -C "$REPO" update-ref "refs/upstream/last-seen" "$UPSTREAM_SHA"

BEHIND=$(git -C "$REPO" rev-list --count "$BASE_SHA..$UPSTREAM_SHA")
if [ "$BEHIND" -eq 0 ]; then
  log "$LOG_PREFIX: no upstream intake needed (master $UPSTREAM_SHA already in $BASE_BRANCH $BASE_SHA)"
  exit 0
fi

log "$LOG_PREFIX: upstream master $UPSTREAM_SHA is $BEHIND commit(s) ahead of $BASE_BRANCH $BASE_SHA"

mkdir -p "$WORK_ROOT" "$REPORT_DIR"
WORKTREE=$(mktemp -d "$WORK_ROOT/worktree.XXXXXX")
git -C "$REPO" worktree add --detach "$WORKTREE" "$UPSTREAM_SHA" >/dev/null

BRANCH="upstream-intake/$(date -u +%Y%m%d)-${UPSTREAM_SHA:0:8}"
REPORT="$REPORT_DIR/$(date -u +%Y%m%d)-${UPSTREAM_SHA:0:8}.md"
COMMITS=$(git -C "$WORKTREE" log --oneline --no-decorate "$BASE_SHA..$UPSTREAM_SHA" | head -50)

PROMPT=$(cat <<EOF
You are reviewing upstream 9router commits for LiteRouter, a deliberately minimal fork.

Upstream: $(git -C "$REPO" remote get-url "$REMOTE") at $UPSTREAM_SHA
LiteRouter base: $BASE_SHA ($BASE_BRANCH)
Commits under review:
$COMMITS

Retained-core paths only: security, protocol compatibility, routing correctness,
SQLite/DB correctness, or measured performance fixes. Deleted tunnel, MITM,
cloud-sync, GitBook, and UI code stays deleted. Never merge upstream wholesale.

Tasks:
1. Write a short change/risk report to $REPORT (markdown, bullet list, one line per
   commit: SHA, subject, keep/drop, why).
2. Cherry-pick only keep commits onto a new branch "$BRANCH" from $BASE_SHA,
   using `git cherry-pick -x`. Resolve conflicts in favour of LiteRouter's deletions.
3. Do not merge, do not deploy, do not touch production.
4. Leave the worktree at $WORKTREE; report the branch name, the pushed PR URL, and
   anything you had to skip.
EOF
)

codex exec --cd "$WORKTREE" --sandbox danger-full-access "$PROMPT" \
  >"$REPORT_DIR/.$(date -u +%Y%m%d)-${UPSTREAM_SHA:0:8}.log" 2>&1 || log "$LOG_PREFIX: codex exec exited non-zero"

if git -C "$WORKTREE" rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then
  git -C "$WORKTREE" push "$TARGET" "$BRANCH" >/dev/null 2>&1 || log "$LOG_PREFIX: push failed for $BRANCH"
  PR_URL=$(gh pr list --repo raufimusaddiq/literouter --head "$BRANCH" --state all --json url --jq '.[0].url' 2>/dev/null || true)
  if [ -z "$PR_URL" ]; then
    PR_URL=$(gh pr create --repo raufimusaddiq/literouter --base "$STAGING_BRANCH" --head "$BRANCH" \
      --title "upstream intake $(date -u +%Y-%m-%d) (${UPSTREAM_SHA:0:8})" \
      --body "Disposable upstream intake for $UPSTREAM_SHA. Review only; do not merge without staging gates. Report: $REPORT" 2>&1 | tail -1)
  fi
  log "$LOG_PREFIX: upstream $UPSTREAM_SHA behind=$BEHIND branch=$BRANCH pr=$PR_URL"
else
  log "$LOG_PREFIX: upstream $UPSTREAM_SHA behind=$BEHIND; no branch produced; report=$REPORT"
fi
