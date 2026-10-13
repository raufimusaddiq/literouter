#!/usr/bin/env bash
# Retention for disposable upstream-intake clones ($WORK_ROOT/worktree.*).
# Sourced by upstream-intake.sh (and by tests); defines functions only.
# Needs: REPO REMOTE TARGET BASE_BRANCH WORK_ROOT LOG_PREFIX and log().
#
# Policy: a clone is reclaimable only when every piece of work in it is provably
# preserved elsewhere. Anything unknown, unreadable, stale or unpushed is kept.
#   * every local branch head is merged into $TARGET/$BASE_BRANCH, or is an ancestor
#     of the same-named branch on $TARGET (freshly fetched) with no open PR;
#   * HEAD is on such a branch, or detached at a commit already in $REMOTE/master or
#     $TARGET/$BASE_BRANCH (an upstream commit under review is not agent work);
#   * no ref outside refs/heads, refs/remotes, refs/tags (stash, notes, ...);
#   * work tree identical to HEAD (content hashes, no filters): no staged, modified,
#     deleted or untracked files (the generated reports are ignored);
#   * garbage collection only: last activity older than RETAIN_DAYS (>= 2).
# The clone is untrusted: git reads it with --git-dir only (no work tree, so no
# filters/fsmonitor/hooks) and with config keys that execute programs overridden.

RETAIN_DAYS=${UPSTREAM_INTAKE_RETAIN_DAYS:-14}
RETAIN_SCAN_MAX=${UPSTREAM_INTAKE_GC_SCAN_MAX:-50}
RETAIN_DELETE_MAX=${UPSTREAM_INTAKE_GC_DELETE_MAX:-5}
RETENTION_OPEN_BRANCHES=""
RETENTION_REASON=""

retention_log() { log "$LOG_PREFIX: retention: $*"; }

retention_clone_git() {
  local dir=$1; shift
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git --no-optional-locks \
    -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.pager=cat \
    -c core.sshCommand=false -c core.gitProxy= -c core.askPass= -c protocol.ext.allow=never \
    --git-dir="$dir/.git" "$@"
}

retention_host_git() { git -C "$REPO" "$@"; }

# Absolute, non-symlink work root that is not "/".
retention_root_ok() {
  [[ "$WORK_ROOT" == /?* ]] && [ -d "$WORK_ROOT" ] && [ ! -L "$WORK_ROOT" ] || return 1
  [ "$(realpath -e -- "$WORK_ROOT")" = "$WORK_ROOT" ] || return 1
}

# A direct, real, same-owner child named worktree.XXXXXX with a real .git directory.
retention_safe_dir() {
  local dir=$1 base=${1##*/} real
  retention_root_ok || return 1
  [[ "$base" =~ ^worktree\.[A-Za-z0-9]{6}$ ]] || return 1
  [ "${dir%/*}" = "$WORK_ROOT" ] || return 1
  [ -d "$dir" ] && [ ! -L "$dir" ] || return 1
  [ "$(stat -c %u -- "$dir")" = "$(id -u)" ] || return 1
  real=$(realpath -e -- "$dir") || return 1
  [ "$real" = "$WORK_ROOT/$base" ] || return 1
  [ -d "$dir/.git" ] && [ ! -L "$dir/.git" ] || return 1
}

# Any activity (files, refs, index) newer than the retention window; errors count as recent.
retention_recent() {
  local hit
  hit=$(find "$1" -path "$1/.git/objects" -prune -o -newermt "$RETAIN_DAYS days ago" -print -quit 2>/dev/null) || return 0
  [ -n "$hit" ]
}

# Uncommitted, staged, deleted or untracked work. Compares the work tree with the HEAD
# tree directly (raw content hashes, no filters, no index), so staged-only edits and
# deletions are visible. Any doubt counts as edits. A clone never checked out (no index)
# is clean only if its work tree is empty. Returns 0 = edits/doubt, 1 = clean.
retention_has_edits() {
  local tmp rc=0
  tmp=$(mktemp -d) || return 0
  retention_edits_scan "$1" "$tmp" || rc=$?
  rm -rf -- "$tmp"
  return "$rc"
}

retention_edits_scan() {
  local dir=$1 tmp=$2 rec meta path mode sha abs actual leftovers
  local -x LC_ALL=C
  if [ ! -e "$dir/.git/index" ]; then
    leftovers=$(find "$dir" -mindepth 1 -maxdepth 1 ! -name .git -print -quit 2>/dev/null) || return 0
    [ -z "$leftovers" ] || return 0
    return 1
  fi
  # Staged content that differs from HEAD (even if the work tree was restored to HEAD).
  retention_clone_git "$dir" diff-index --cached --quiet HEAD -- 2>/dev/null || return 0
  retention_clone_git "$dir" ls-tree -r -z --full-tree HEAD > "$tmp/tree" 2>/dev/null || return 0
  : > "$tmp/paths"; : > "$tmp/expected"; : > "$tmp/tracked"
  while IFS= read -r -d '' rec; do
    meta=${rec%%$'\t'*}
    path=${rec#*$'\t'}
    read -r mode _ sha <<< "$meta"
    [[ "$path" != *$'\n'* ]] || return 0
    abs=$dir/$path
    printf '%s\0' "$path" >> "$tmp/tracked"
    case "$mode" in
      100644|100755)
        { [ -f "$abs" ] && [ ! -L "$abs" ]; } || return 0
        if [ "$mode" = 100755 ]; then [ -x "$abs" ] || return 0; else [ ! -x "$abs" ] || return 0; fi
        printf '%s\n' "$abs" >> "$tmp/paths"
        printf '%s\n' "$sha" >> "$tmp/expected" ;;
      120000)
        [ -L "$abs" ] || return 0
        actual=$(readlink -- "$abs" | tr -d '\n' | retention_clone_git "$dir" hash-object --stdin) || return 0
        [ "$actual" = "$sha" ] || return 0 ;;
      *) return 0 ;;
    esac
  done < "$tmp/tree"
  if [ -s "$tmp/paths" ]; then
    retention_clone_git "$dir" hash-object --no-filters --stdin-paths < "$tmp/paths" > "$tmp/actual" 2>/dev/null || return 0
    cmp -s "$tmp/expected" "$tmp/actual" || return 0
  fi
  find "$dir" -path "$dir/.git" -prune -o ! -type d ! -path "$dir/intake-report.md" \
    ! -path "$dir/intake-ci-feedback.txt" -printf '%P\0' 2>/dev/null | sort -z > "$tmp/files" || return 0
  sort -z < "$tmp/tracked" > "$tmp/tracked.sorted" || return 0
  [ "$(comm -z -13 "$tmp/tracked.sorted" "$tmp/files" | head -c 1 | wc -c)" -eq 0 ] || return 0
  return 1
}

retention_load_open_prs() {
  local out count
  out=$(gh pr list --repo raufimusaddiq/literouter --state open --limit 100 --json headRefName --jq '.[].headRefName') || return 1
  count=$(grep -c . <<< "$out" || true)
  [ "$count" -lt 100 ] || return 1
  RETENTION_OPEN_BRANCHES=$out
}

retention_known_upstream_commit() {
  retention_host_git merge-base --is-ancestor "$1" "refs/remotes/$REMOTE/master" 2>/dev/null \
    || retention_host_git merge-base --is-ancestor "$1" "refs/remotes/$TARGET/$BASE_BRANCH" 2>/dev/null
}

retention_branch_published() {
  local name=$1 sha=$2
  if grep -Fxq -- "$name" <<< "$RETENTION_OPEN_BRANCHES"; then RETENTION_REASON="branch $name has an open PR"; return 1; fi
  if retention_host_git merge-base --is-ancestor "$sha" "refs/remotes/$TARGET/$BASE_BRANCH" 2>/dev/null; then return 0; fi
  if ! retention_host_git fetch --quiet --no-tags "$TARGET" "+refs/heads/$name:refs/remotes/$TARGET/$name" 2>/dev/null; then
    RETENTION_REASON="branch $name not on $TARGET (unpublished or unverifiable)"; return 1
  fi
  if ! retention_host_git merge-base --is-ancestor "$sha" "refs/remotes/$TARGET/$name" 2>/dev/null; then
    RETENTION_REASON="branch $name has commits not on $TARGET"; return 1
  fi
}

# $1 clone, $2 enforce age (1 = GC, 0 = failed-run cleanup). 0 = reclaimable.
retention_classify() {
  local dir=$1 enforce_age=${2:-1} refs ref sha name head_ref head_sha
  RETENTION_REASON=""
  retention_safe_dir "$dir" || { RETENTION_REASON="unsafe path"; return 1; }
  if [ "$enforce_age" = 1 ] && retention_recent "$dir"; then RETENTION_REASON="active within ${RETAIN_DAYS}d"; return 1; fi
  refs=$(retention_clone_git "$dir" for-each-ref --format='%(refname) %(objectname)') \
    || { RETENTION_REASON="refs unreadable"; return 1; }
  while read -r ref sha; do
    [ -n "$ref" ] || continue
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { RETENTION_REASON="bad object for $ref"; return 1; }
    case "$ref" in
      refs/heads/*)
        name=${ref#refs/heads/}
        git check-ref-format --branch "$name" >/dev/null 2>&1 || { RETENTION_REASON="odd branch name"; return 1; }
        retention_branch_published "$name" "$sha" || return 1 ;;
      refs/remotes/*|refs/tags/*) ;;
      *) RETENTION_REASON="unknown ref $ref"; return 1 ;;
    esac
  done <<< "$refs"
  if head_ref=$(retention_clone_git "$dir" symbolic-ref -q HEAD 2>/dev/null); then
    retention_clone_git "$dir" show-ref --verify --quiet "$head_ref" || { RETENTION_REASON="unborn or missing HEAD ref"; return 1; }
  else
    head_sha=$(retention_clone_git "$dir" rev-parse -q --verify 'HEAD^{commit}') || { RETENTION_REASON="HEAD unreadable"; return 1; }
    retention_known_upstream_commit "$head_sha" || { RETENTION_REASON="detached HEAD at unrecognized commit"; return 1; }
  fi
  if retention_has_edits "$dir"; then RETENTION_REASON="uncommitted or untracked edits"; return 1; fi
  RETENTION_REASON="all work published or upstream"
}

retention_remove() {
  retention_safe_dir "$1" || return 1
  rm -rf --one-file-system -- "$1"
}

# Failed-run cleanup: remove this run's clone only when it provably holds nothing unpublished.
retention_reclaim_failed() {
  retention_load_open_prs || { RETENTION_REASON="PR state unavailable"; return 1; }
  retention_classify "$1" 0 || return 1
  retention_remove "$1" || { RETENTION_REASON="removal refused"; return 1; }
}

# Bounded startup GC over direct worktree.* children older than RETAIN_DAYS.
retention_gc() {
  local candidates=() dir removed=0 lock_fd
  [[ "$RETAIN_DAYS" =~ ^[0-9]+$ ]] && [ "$RETAIN_DAYS" -ge 2 ] \
    && [[ "$RETAIN_SCAN_MAX" =~ ^[0-9]+$ ]] && [ "$RETAIN_SCAN_MAX" -ge 1 ] \
    && [[ "$RETAIN_DELETE_MAX" =~ ^[0-9]+$ ]] || { retention_log "invalid retention settings; GC skipped"; return 0; }
  retention_root_ok || { retention_log "work root unsafe; GC skipped"; return 0; }
  exec {lock_fd}>"$WORK_ROOT/.gc.lock"
  flock -n "$lock_fd" || { retention_log "another GC holds the lock; skipped"; exec {lock_fd}>&-; return 0; }
  if ! retention_load_open_prs; then retention_log "open-PR state unavailable; GC skipped"; exec {lock_fd}>&-; return 0; fi
  mapfile -t candidates < <(find "$WORK_ROOT" -mindepth 1 -maxdepth 1 -name 'worktree.*' -printf '%T@ %p\n' 2>/dev/null \
    | sort -n | head -n "$RETAIN_SCAN_MAX" | cut -d' ' -f2-)
  for dir in "${candidates[@]}"; do
    [ "$removed" -lt "$RETAIN_DELETE_MAX" ] || break
    [ "$dir" != "${WORKTREE:-}" ] || continue
    if [ -L "$dir" ]; then retention_log "skip $dir: symlink"; continue; fi
    if retention_classify "$dir" 1; then
      if retention_remove "$dir"; then removed=$((removed + 1)); retention_log "removed $dir ($RETENTION_REASON)"
      else retention_log "kept $dir: removal refused"; fi
    else
      retention_log "kept $dir: $RETENTION_REASON"
    fi
  done
  retention_log "scanned ${#candidates[@]} clone(s), removed $removed (retain=${RETAIN_DAYS}d scan<=$RETAIN_SCAN_MAX delete<=$RETAIN_DELETE_MAX)"
  exec {lock_fd}>&-
  return 0
}
