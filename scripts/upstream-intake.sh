#!/usr/bin/env bash
# Daily upstream intake for LiteRouter (see docs/literouter-baseline/production-promotion-plan.md).
# Disposable worktree -> one non-interactive Codex session -> retained-core only
# cherry-pick branch -> PR against main -> wait CI + Hermes -> merge -> wait the
# production image -> deploy the immutable tag -> smoke the public endpoint.
# Staging is sunset: never deploy or promote staging again.

set -euo pipefail

REPO=/opt/9router
REMOTE=origin                 # decolua/9router (upstream master)
TARGET=origin-literouter      # raufimusaddiq/literouter
BASE_BRANCH=main
DEPLOY=${UPSTREAM_INTAKE_DEPLOY:-true}    # gated merge+deploy tail enabled
SSH_HOST=VM-8-96-ubuntu                   # this box, for the deploy tail over ssh
WORK_ROOT=${UPSTREAM_INTAKE_DIR:-/var/tmp/9router-upstream-intake}
REPORT_DIR=$REPO/docs/literouter-baseline/intake
LOG_PREFIX=upstream-intake

log() { printf '%s %s\n' "$(date -Is)" "$*"; }

# --- gated tail helpers -------------------------------------------------------

# Wait for every required check on a PR head, then require Hermes APPROVE.
# Returns non-zero on failure or timeout so the caller never merges blindly.
wait_for_gates() {
  local pr=$1 deadline=$(( $(date +%s) + 3600 )) state verdict
  while [ "$(date +%s)" -lt "$deadline" ]; do
    state=$(gh pr view "$pr" --repo raufimusaddiq/literouter --json mergeStateStatus,statusCheckRollup \
      --jq '[.mergeStateStatus, ([.statusCheckRollup[] | select(.conclusion=="FAILURE" or .conclusion=="CANCELLED")] | length)] | @tsv')
    verdict=$(gh pr view "$pr" --repo raufimusaddiq/literouter --json reviews \
      --jq '[.reviews[].state] | if any(. == "CHANGES_REQUESTED") then "CHANGES_REQUESTED" elif any(. == "APPROVED") then "APPROVED" else "PENDING" end')
    log "$LOG_PREFIX: pr=$pr state=$state review=$verdict"
    case "$state" in *$'\t0') ;; *) log "$LOG_PREFIX: pr=$pr a check failed"; return 1 ;; esac
    if [ "$verdict" = APPROVED ] && [ "${state%%$'\t'*}" = CLEAN ]; then return 0; fi
    if [ "$verdict" = CHANGES_REQUESTED ]; then log "$LOG_PREFIX: pr=$pr changes requested"; return 1; fi
    sleep 30
  done
  log "$LOG_PREFIX: pr=$pr gate wait timed out"; return 1
}

# Merge, wait the main image build, pull, recreate, smoke. Mirrors the runbook:
# builds happen in CI, this box only pulls; one SQLite writer, so stop-before-start.
deploy_main() {
  local sha=$1 tag="production-$sha"
  gh pr merge "$2" --repo raufimusaddiq/literouter --merge --delete-branch=false || return 1
  git -C "$REPO" fetch --quiet "$TARGET" main
  git -C "$REPO" merge-base --is-ancestor "$TARGET/main" "$TARGET/main" >/dev/null 2>&1 || true
  local run
  for _ in $(seq 1 60); do
    run=$(gh run list --repo raufimusaddiq/literouter --workflow production-image.yml --limit 5 \
      --json databaseId,headSha,status,conclusion \
      --jq "[.[] | select(.headSha==\"$sha\")][0] | \"\\(.databaseId) \\(.status) \\(.conclusion)\"")
    case "$run" in ""*) sleep 20; continue ;; *"completed success"*) break ;; *"completed "*) log "$LOG_PREFIX: image build failed ($run)"; return 1 ;; esac
    sleep 20
  done
  [ -n "$run" ] || { log "$LOG_PREFIX: no production image run for $sha"; return 1; }
  ssh -o BatchMode=yes "$SSH_HOST" "docker pull ghcr.io/raufimusaddiq/literouter-production:$tag" || return 1
  ssh -o BatchMode=yes "$SSH_HOST" "cd /opt/9router && LITEROUTER_PRODUCTION_TAG=$tag docker compose -f compose.production.yml up -d --no-build" || return 1
  for _ in $(seq 1 30); do
    [ "$(ssh -o BatchMode=yes "$SSH_HOST" docker inspect -f '{{.State.Health.Status}}' literouter)" = healthy ] && break
    sleep 5
  done
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 https://ai.investdx.biz.id/api/health)
  log "$LOG_PREFIX: deployed $tag smoke=$code"
  [ "$code" = 200 ]
}

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
3. Do not merge, do not deploy, do not touch production. Staging is sunset: never
   target or deploy the staging branch.
4. Leave the worktree at $WORKTREE; leave keep commits unpushed. The timer pushes
   the branch, opens a PR against $BASE_BRANCH, and owns the gated deploy tail.
5. If every commit is a drop, create no branch and say so.
EOF
)

codex exec --cd "$WORKTREE" --sandbox danger-full-access "$PROMPT" \
  >"$REPORT_DIR/.$(date -u +%Y%m%d)-${UPSTREAM_SHA:0:8}.log" 2>&1 || log "$LOG_PREFIX: codex exec exited non-zero"

if ! git -C "$WORKTREE" rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then
  log "$LOG_PREFIX: upstream $UPSTREAM_SHA behind=$BEHIND; nothing retained; report=$REPORT"
  exit 0
fi

git -C "$WORKTREE" push "$TARGET" "$BRANCH" >/dev/null 2>&1 || { log "$LOG_PREFIX: push failed for $BRANCH"; exit 1; }
PR_URL=$(gh pr list --repo raufimusaddiq/literouter --head "$BRANCH" --state all --json url --jq '.[0].url' 2>/dev/null || true)
if [ -z "$PR_URL" ]; then
  PR_URL=$(gh pr create --repo raufimusaddiq/literouter --base "$BASE_BRANCH" --head "$BRANCH" \
    --title "upstream intake $(date -u +%Y-%m-%d) (${UPSTREAM_SHA:0:8})" \
    --body "Retained-core upstream intake for $UPSTREAM_SHA (behind=$BEHIND). Staging is sunset; this targets $BASE_BRANCH directly. Report: $REPORT" 2>&1 | tail -1)
fi
log "$LOG_PREFIX: upstream $UPSTREAM_SHA behind=$BEHIND branch=$BRANCH pr=$PR_URL"

if [ "$DEPLOY" != true ]; then
  log "$LOG_PREFIX: deploy tail disabled (UPSTREAM_INTAKE_DEPLOY=false); awaiting CI + Hermes on $PR_URL"
  exit 0
fi

PR_NUM=$(basename "$PR_URL")
wait_for_gates "$PR_NUM" || { log "$LOG_PREFIX: gates not satisfied; not merging $PR_URL"; exit 1; }
HEAD_SHA=$(gh pr view "$PR_NUM" --repo raufimusaddiq/literouter --json headRefOid --jq .headRefOid)
deploy_main "$HEAD_SHA" "$PR_NUM" || { log "$LOG_PREFIX: deploy tail failed for $PR_URL"; exit 1; }
log "$LOG_PREFIX: released $HEAD_SHA from $PR_URL"
