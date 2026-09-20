#!/usr/bin/env bash
# Records the Phase 3 swap: repoint the Caddy upstream, probe the public host
# throughout, and write the timing/failure counts into a doc. Two containers must
# not serve from 9router-data at once, so this flips the edge, it does not overlap.
#
# usage: scripts/edge-swap-rehearsal.sh <host> <target-ip:port> <out.md> [attempts]
set -euo pipefail

caddyfile=${CADDYFILE:-/opt/idx/infra/caddy/Caddyfile}
host=$1
target=$2
out=$3
attempts=${4:-12}

# Scope the read to this site block. A file-wide grep selects the first proxy,
# which can be another public application entirely.
block=$(awk -v h="$host" '$0 == h || $0 == h " {" {inside = 1} inside {print} inside && /^}/{exit}' "$caddyfile")
current=$(printf '%s\n' "$block" | grep -oP '(?<=reverse_proxy )\S+' | head -1)
test -n "$current" || { echo "no reverse_proxy line in $caddyfile" >&2; exit 1; }
backup="$caddyfile.bak-swap-$host-$(date +%s)"
cp "$caddyfile" "$backup"
swapped=false

reload() {
  # Caddy's admin endpoint binds inside the container and rejects the zero-Origin
  # form a plain `docker exec` sends, so reload through a sibling container
  # sharing that network namespace. `caddy reload` in-container returns 403 here.
  docker run --rm --network container:idx-caddy -v "$caddyfile:/tmp/Caddyfile:ro" curlimages/curl:latest \
    -s -X POST http://127.0.0.1:2019/load \
    -H 'Content-Type: text/caddyfile' --data-binary @/tmp/Caddyfile \
    -o /dev/null -w '%{http_code}' | grep -qx 200
}

restore() {
  test "$swapped" = true || return 0
  cp "$backup" "$caddyfile"
  reload || true
  echo "restored $host from $backup" >&2
}
trap restore ERR INT TERM

sweep() { # print one status per attempt, as fast as curl allows
  local i
  for ((i = 0; i < attempts; i++)); do
    curl -s -o /dev/null -w '%{http_code} %{time_total}\n' --max-time 10 "https://$host/v1/models"
  done
}

before=$(sweep)
start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
awk -v h="$host" -v old="$current" -v new="$target" '
  $0 == h || $0 == h " {" {inside = 1}
  inside && !done && $0 ~ /reverse_proxy / {sub(old, new); done = 1}
  {print}
  inside && /^}/ {inside = 0}
' "$caddyfile" > "$caddyfile.tmp"
mv "$caddyfile.tmp" "$caddyfile"
actual=$(awk -v h="$host" '$0 == h || $0 == h " {" {inside = 1} inside && /reverse_proxy / {sub(/^.*reverse_proxy /, ""); print; exit}' "$caddyfile")
test "$actual" = "$target" || { echo "edited wrong site block: expected $target, got $actual" >&2; exit 1; }
swapped=true
reload
after=$(sweep)
end=$(date -u +%Y-%m-%dT%H:%M:%SZ)

{
  echo "# Edge swap rehearsal"
  echo
  echo "Recorded by \`scripts/edge-swap-rehearsal.sh\` on $(date -u +%Y-%m-%dT%H:%M:%SZ)."
  echo
  echo "| Field | Value |"
  echo "| --- | --- |"
  echo "| Caddy upstream before | \`$current\` |"
  echo "| Caddy upstream after | \`$target\` |"
  echo "| Write window | $start -> $end |"
  echo "| Host probed | \`$host\` |"
  echo "| Probes before/after | $attempts + $attempts |"
  echo "| Probes reaching router (200/401/403) | $(printf '%s\n%s\n' "$before" "$after" | awk '$1 == 200 || $1 == 401 || $1 == 403 {n++} END {print n+0}') / $((attempts * 2)) |"
  echo
  echo '```text'
  echo "before ($current):"
  printf '%s\n' "$before" | awk '{print $1}' | sort | uniq -c | sed 's/^/  /'
  echo "after ($target):"
  printf '%s\n' "$after" | awk '{print $1}' | sort | uniq -c | sed 's/^/  /'
  echo '```'
  echo
  echo "Rollback: \`cp $backup $caddyfile\` then reload"
} > "$out"

echo "wrote $out (before=$current after=$target)"
