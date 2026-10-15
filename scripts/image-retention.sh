#!/usr/bin/env bash
# Automatic production image retention for LiteRouter.
#
# `scripts/post-deploy.sh` owns the pruning logic and stays the single
# implementation; this wrapper only supplies the two tags it requires. It never
# removes anything itself: invoked with no argument (the scheduled default) it
# runs post-deploy.sh's read-only manifest. Deletion needs the separately
# approved LITEROUTER_APPLY=true.
#
# Tags come from the live container, never from image age:
#   * current  - the `production-<full-sha>` tag the running `literouter`
#                container is actually on (read-only `docker inspect`). A
#                rollback legitimately runs an older build, so age or list order
#                can never identify a release.
#   * previous - the tag this unit last observed running, kept for rollback.
#
# post-deploy.sh already refuses to remove any image referenced by a running or
# stopped container, so a rollback target still referenced by a container is
# protected no matter what this file records. The recorded tag covers the case
# where no container holds the rollback image.
#
# Fail-safe: an unreadable, unhealthy or unexpected container, or an unusable
# recorded tag, aborts before any pruning. The schedule runs the manifest, not
# deletion. See docs/literouter-baseline/pr-merge-runbook.md#production-image-retention.

set -euo pipefail

repository=ghcr.io/raufimusaddiq/literouter-production
container=${LITEROUTER_CONTAINER:-literouter}
state_file=${LITEROUTER_STATE_FILE:-/var/tmp/9router-image-retention/state}
docker_bin=${DOCKER_BIN:-docker}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
fail() { log "ERROR: $*" >&2; exit 1; }

# 1. The running release, read from the live container.
state=$("$docker_bin" container inspect "$container" \
  --format '{{.Config.Image}} {{.Image}} {{.State.Running}} {{.State.Health.Status}}') \
  || fail "cannot inspect container $container"
read -r reference container_id running health <<< "$state"
[ "$running" = true ] && [ "$health" = healthy ] \
  || fail "container $container is not running and healthy; refusing to derive tags"
case "$reference" in
  "$repository":*) ;;
  *) fail "container $container does not run $repository (got: $reference)" ;;
esac
current=${reference#"$repository":}
[[ "$current" =~ ^production-[0-9a-f]{40}$ ]] \
  || fail "container $container is on an unexpected tag: $current"
[[ "$container_id" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || fail "container $container has an unexpected image id: $container_id"

# 2. The previous release: the tag this unit last observed running. A deployment
#    overwrites it with the tag that was running before it, so the rollback tag
#    survives the next deploy.
previous=none
if [ -f "$state_file" ]; then
  recorded=$(sed -n 's/^current=//p' "$state_file" | head -n1)
  if [[ "$recorded" =~ ^production-[0-9a-f]{40}$ ]]; then
    if [ "$recorded" != "$current" ]; then
      previous=$recorded
    else
      # Nothing changed since the last run; keep the rollback tag already recorded.
      inherited=$(sed -n 's/^previous=//p' "$state_file" | head -n1)
      if [ -n "$inherited" ]; then previous=$inherited; fi
    fi
  fi
fi
[[ "$previous" = none || "$previous" =~ ^production-[0-9a-f]{40}$ ]] \
  || fail "unusable previous tag in $state_file: $previous"

# 3. Persist before pruning so the rollback tag survives a failed run.
mkdir -p -- "$(dirname -- "$state_file")"
tmp="$state_file.tmp.$$"
printf 'current=%s\nprevious=%s\n' "$current" "$previous" > "$tmp"
mv -f -- "$tmp" "$state_file"

# 4. Single pruning implementation; read-only unless deletion was approved.
apply_args=()
if [ "${LITEROUTER_APPLY:-false}" = true ]; then apply_args=(--apply); fi
log "retention: current=$current previous=$previous apply=${LITEROUTER_APPLY:-false}"
LITEROUTER_PRODUCTION_TAG="$current" \
LITEROUTER_PREVIOUS_PRODUCTION_TAG="$previous" \
  bash "$script_dir/post-deploy.sh" ${apply_args[@]+"${apply_args[@]}"}
