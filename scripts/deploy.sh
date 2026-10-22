#!/usr/bin/env bash
# Deploy an already-published, immutable production image and remove the tag it
# replaced. One deploy replaces one image with one image, so the local image
# store does not grow.
#
# Run on the host:  bash scripts/deploy.sh <full-main-sha>
#
# The image must already exist in GHCR, published by
# .github/workflows/production-image.yml for that exact main commit. This script
# never builds locally, never pulls `latest`, and never touches a tag other than
# the one it just replaced. It is the manual deploy path; it starts exactly one
# container on the `9router-data` volume, so SQLite keeps a single writer.
#
# The old tag is removed only after the new container is healthy and the public
# endpoint answers. If any check fails the old tag stays, so the failed deploy
# remains rollback-able.
set -euo pipefail

repository=ghcr.io/raufimusaddiq/literouter-production
container=literouter
compose_file=/home/ubuntu/9router/compose.production.yml
health_url=https://ai.investdx.biz.id/api/health
docker_bin=${DOCKER_BIN:-docker}
curl_bin=${CURL_BIN:-curl}

usage() {
  echo 'usage: bash scripts/deploy.sh <full-main-sha>' >&2
  echo '  <full-main-sha> is 40 lowercase hex characters, e.g. 0123abcd...; not a short sha, a branch, or latest' >&2
  exit 2
}

[ "$#" -eq 1 ] || usage
sha=$1
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid full-main-sha: $sha" >&2; usage; }
tag="production-$sha"
image="$repository:$tag"

# The tag being replaced, read from the live container. Abort rather than guess:
# without it there is no way to know which tag this deploy makes obsolete.
running=$("$docker_bin" container inspect "$container" --format '{{.Config.Image}}') \
  || { echo "cannot inspect container $container; refusing to deploy" >&2; exit 1; }
case "$running" in
  "$repository":*) old=${running#"$repository":} ;;
  *) echo "container $container is not on $repository (got: $running); refusing to deploy" >&2; exit 1 ;;
esac
[[ "$old" =~ ^production-[0-9a-f]{40}$ ]] \
  || { echo "container $container is on an unexpected tag: $old; refusing to deploy" >&2; exit 1; }

echo "deploying $image (replacing $old)"
# --wait blocks until the replacement is healthy, so a successful deploy is not
# misread as a failure while its healthcheck is still `starting`. Without it,
# `up -d` returns as soon as the container starts and the health check below can
# fail on a deploy that would have passed (compose.production.yml has a 30s
# interval and start period), which would skip the prune and, on a retry, record
# the new release as `old` and leave the replaced image behind for good.
LITEROUTER_PRODUCTION_TAG="$tag" \
  "$docker_bin" compose --project-directory /home/ubuntu/9router -f "$compose_file" up -d --no-build \
  --wait --wait-timeout "${LITEROUTER_WAIT_TIMEOUT:-300}"

# Verify before removing anything: the container must report healthy, and the
# public endpoint must answer.
"$docker_bin" container inspect "$container" --format '{{.State.Health.Status}}' | grep -q '^healthy$' \
  || { echo "container $container is not healthy; keeping $old for rollback" >&2; exit 1; }
"$curl_bin" --fail --silent --show-error --max-time 30 "$health_url" >/dev/null \
  || { echo "$health_url did not answer; keeping $old for rollback" >&2; exit 1; }

# Remove exactly the tag this deploy replaced, and only if it changed. A same-tag
# redeploy has nothing to reclaim.
if [ "$old" = "$tag" ]; then
  echo "same tag redeployed; nothing to remove"
else
  "$docker_bin" image rm "$repository:$old"
  echo "removed $repository:$old"
fi
