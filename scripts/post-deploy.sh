#!/usr/bin/env bash
set -euo pipefail

# N=2: the deployed release and the explicitly recorded rollback release.
# See docs/literouter-baseline/pr-merge-runbook.md#production-image-retention.
repository=ghcr.io/raufimusaddiq/literouter-production
docker_bin=${DOCKER_BIN:-docker}
current=${LITEROUTER_PRODUCTION_TAG:?set LITEROUTER_PRODUCTION_TAG}
previous=${LITEROUTER_PREVIOUS_PRODUCTION_TAG:?set LITEROUTER_PREVIOUS_PRODUCTION_TAG}
apply=false
if [ "$#" -gt 1 ]; then
  echo 'usage: bash scripts/post-deploy.sh [--apply]' >&2
  exit 2
fi
case "${1:-}" in
  '') ;;
  --apply) apply=true ;;
  *) echo 'usage: bash scripts/post-deploy.sh [--apply]' >&2; exit 2 ;;
esac
for tag in "$current" "$previous"; do
  if ! [[ "$tag" =~ ^production-[0-9a-f]{40}$ ]]; then
    echo "invalid production tag: $tag" >&2
    exit 1
  fi
done
if [ "$current" = "$previous" ]; then
  echo 'current and previous tags are identical; skipping image cleanup'
  exit 0
fi

current_id=$("$docker_bin" image inspect "$repository:$current" --format '{{.Id}}')
"$docker_bin" image inspect "$repository:$previous" --format '{{.Id}}' >/dev/null

container_images() {
  local state ids inspected reference referenced_id found=false
  local -a containers
  state=$("$docker_bin" container inspect literouter --format '{{.Config.Image}} {{.Image}} {{.State.Running}} {{.State.Health.Status}}') || return 1
  if [ "$state" != "$repository:$current $current_id true healthy" ]; then
    echo 'literouter is not healthy on the expected image; refusing cleanup' >&2
    return 1
  fi
  ids=$("$docker_bin" container ls --all --quiet) || return 1
  [ -n "$ids" ] || { echo 'empty container inventory; refusing cleanup' >&2; return 1; }
  mapfile -t containers <<< "$ids"
  inspected=$("$docker_bin" container inspect --format '{{.Config.Image}} {{.Image}}' "${containers[@]}") || return 1
  while read -r reference referenced_id; do
    if ! [[ -n "$reference" && "$referenced_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
      echo 'invalid container inventory; refusing cleanup' >&2
      return 1
    fi
    if [ "$reference" = "$repository:$current" ] && [ "$referenced_id" = "$current_id" ]; then
      found=true
    fi
  done <<< "$inspected"
  [ "$found" = true ] || { echo 'running image missing from container inventory; refusing cleanup' >&2; return 1; }
  printf '%s\n' "$inspected"
}

references=$(container_images)
curl --fail --silent --show-error --max-time 15 https://ai.investdx.biz.id/api/health >/dev/null
images=$("$docker_bin" image ls "$repository" --no-trunc --format '{{.Repository}}:{{.Tag}} {{.ID}}')
while read -r image image_id; do
  [[ "$image" == "$repository:"* ]] || continue
  tag=${image##*:}
  [[ "$tag" =~ ^production-[0-9a-f]{40}$ ]] || continue
  if ! [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "invalid image inventory: $image" >&2
    exit 1
  fi
  if [ "$tag" = "$current" ] || [ "$tag" = "$previous" ]; then
    echo "keep release $image"
    continue
  fi
  # Include stopped containers and aliases/digests; refresh before each removal.
  references=$(container_images)
  protected=false
  while read -r reference referenced_id; do
    if [ "$reference" = "$image" ] || [ "$referenced_id" = "$image_id" ]; then
      protected=true
      break
    fi
  done <<< "$references"
  if [ "$protected" = true ]; then
    echo "keep container reference $image"
  elif [ "$apply" = false ]; then
    echo "would remove $image"
  else
    actual_id=$("$docker_bin" image inspect "$image" --format '{{.Id}}')
    if [ "$actual_id" != "$image_id" ]; then
      echo "image changed during cleanup: $image; refusing removal" >&2
      exit 1
    fi
    "$docker_bin" image rm "$image"
  fi
done <<< "$images"
