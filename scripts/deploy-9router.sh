#!/usr/bin/env bash
# Zero-downtime redeploy for 9router.
#
# Starts a standby on a pinned IP, points Caddy at both pinned addresses with
# a retry window, recreates the primary, then reverts to the primary address.
#
# Usage: scripts/deploy-9router.sh [image-tag]   (default: compose image)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_DIR/compose.production.yml"
CADDYFILE=/opt/idx/infra/caddy/Caddyfile
STANDBY=9router-green
PRIMARY=9router
HEALTH_URL=http://127.0.0.1:20128/api/auth/status
PRIMARY_IP=172.18.0.8
STANDBY_IP=172.18.0.18
NETWORK=idx_default
VOLUME=9router-data

cd "$REPO_DIR"

IMAGE="${1:-$(sed -n 's/^ *image: //p' "$COMPOSE_FILE" | head -1)}"
[ -n "$IMAGE" ] || { echo "no image tag resolved" >&2; exit 1; }

caddy_reload() {
  docker exec idx-caddy sh -lc \
    "caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile > /tmp/caddy-adapt.json && wget -qO- --header='Origin: http://localhost' --header='Content-Type: application/json' --post-file=/tmp/caddy-adapt.json http://127.0.0.1:2019/load" >/dev/null
}

set_upstreams() {
  # "solo" restores the single primary; "standby" sends all traffic to the
  # standby during the recreate window. Docker removes and re-adds the primary
  # DNS entry on recreate, which intermittently breaks Caddy's resolution, so
  # the reliable overlap is a direct switch to a stable standby hostname.
  node - "$CADDYFILE" "$1" <<'NODE'
const fs = require("fs");
const [, , file, mode] = process.argv;
const base = "    reverse_proxy 172.18.0.8:20128";
const swap = [
  "    reverse_proxy 172.18.0.8:20128 172.18.0.18:20128 {",
  "        lb_policy first",
  "        lb_try_duration 60s",
  "        lb_try_interval 100ms",
  "        fail_duration 5s",
  "        max_fails 1",
  "    }",
].join("\n");
const source = fs.readFileSync(file, "utf8");
const collapsed = source.replace(
  / {4}reverse_proxy (?:(?:9router(?:-green)?|172\.18\.0\.\d+):20128 ?)+(?:\{\n(?:.*\n)*? {4}\})?/m,
  base,
);
if (!collapsed.includes(base)) throw new Error("9router upstream line not found");
const updated = collapsed.replace(base, mode === "solo" ? base : swap);
// The Caddyfile is bind-mounted, so replacing it would break the mount inode.
const fd = fs.openSync(file, "r+");
try {
  fs.writeSync(fd, updated, 0, "utf8");
  fs.ftruncateSync(fd, Buffer.byteLength(updated));
} finally {
  fs.closeSync(fd);
}
NODE
  caddy_reload
}

wait_healthy() {
  local container="$1"
  for _ in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || true)" = healthy ] && return 0
    sleep 2
  done
  echo "$container did not become healthy" >&2
  return 1
}

cleanup() {
  # Always leave Caddy pointing at the single primary upstream.
  set_upstreams solo || true
  docker rm -f "$STANDBY" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "image: $IMAGE"
docker rm -f "$STANDBY" >/dev/null 2>&1 || true
docker run -d --name "$STANDBY" \
  --env-file "$REPO_DIR/.env.production" \
  -e DATA_DIR=/app/data -e PORT=20128 -e HOSTNAME=0.0.0.0 -e NODE_ENV=production \
  -e ENABLE_REQUEST_LOGS=true -e REQUEST_LOG_MAX_SIZE_MB=1024 -e REQUEST_LOG_MAX_SESSIONS=1000 \
  -e MODEL_CATALOG_SYNC=off -e DISABLE_BACKGROUND_TOKEN_REFRESH=true \
  --network "$NETWORK" --network-alias "$STANDBY" --ip "$STANDBY_IP" \
  --mount source="$VOLUME",target=/app/data \
  --log-driver=json-file --log-opt max-size=10m --log-opt max-file=5 \
  "$IMAGE" >/dev/null

for _ in $(seq 1 60); do
  docker exec "$STANDBY" node -e "fetch('$HEALTH_URL').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))" 2>/dev/null && break
  sleep 2
done

# Single stable upstream while the primary is recreated. Caddy keeps the same
# resolved standby address; no DNS removal/addition happens for it.
set_upstreams standby
sleep 2

docker compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate "$PRIMARY"
wait_healthy "$PRIMARY"
echo "primary healthy on $IMAGE"
