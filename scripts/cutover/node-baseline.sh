#!/usr/bin/env bash
# Start the real Node production image published for a main commit, for the
# Node-vs-Bun differential parity run. No local Node build: the pulled image
# is the production artifact.
#
# usage: scripts/cutover/node-baseline.sh <full-main-sha> <port> <data-dir>
#
# Optional environment:
#   CONTAINER_NAME   container name (default lr-node-<port>)
#   ENV_FILE         docker --env-file with secrets (JWT_SECRET, API_KEY_SECRET,
#                    MACHINE_ID_SALT, INITIAL_PASSWORD), the stand-in for .env.production
#   UPSTREAM_HOST_IP address host.docker.internal resolves to inside the container
#                    (default host-gateway; on a WSL2 engine pass the Windows host IP)
#   TZ               app timezone (default Asia/Jakarta, as compose.production.yml)
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <full-main-sha> <port> <data-dir>" >&2
  exit 2
fi
sha=$1
port=$2
data_dir=$3
case "$sha" in
  *[!0-9a-f]* | "") echo "sha must be the full lowercase hex main sha" >&2; exit 2 ;;
esac
if [ "${#sha}" -ne 40 ]; then
  echo "sha must be the full 40-character main sha" >&2
  exit 2
fi

image="ghcr.io/raufimusaddiq/literouter-production:production-${sha}"
name="${CONTAINER_NAME:-lr-node-${port}}"

docker pull "$image"

env_file_args=()
if [ -n "${ENV_FILE:-}" ]; then
  env_file_args=(--env-file "$ENV_FILE")
fi

# Same environment as compose.production.yml, minus REDIS_URL / REDIS_KEY_PREFIX.
MSYS_NO_PATHCONV=1 docker run -d \
  --name "$name" \
  --memory 768m \
  -p "127.0.0.1:${port}:20128" \
  -v "${data_dir}:/app/data" \
  --add-host "host.docker.internal:${UPSTREAM_HOST_IP:-host-gateway}" \
  "${env_file_args[@]}" \
  -e DATA_DIR=/app/data \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -e NODE_ENV=production \
  -e "TZ=${TZ:-Asia/Jakarta}" \
  -e LOG_LEVEL=WARN \
  -e ENABLE_REQUEST_LOGS=true \
  -e OBSERVABILITY_MAX_RECORDS=15000 \
  -e REQUEST_LOG_MAX_SIZE_MB=500 \
  -e REQUEST_LOG_MAX_SESSIONS=1000 \
  -e MODEL_CATALOG_SYNC=off \
  -e DISABLE_BACKGROUND_TOKEN_REFRESH=true \
  -e MINIMAL_PROFILE=true \
  -e NODE_OPTIONS=--max-old-space-size=512 \
  "$image"
