# Edge swap rehearsal

Phase 2's last unrecorded check: repoint the public edge from one router
container to the other and observe the host throughout. This is a **flip**, not
an overlap — the two containers do not serve from `9router-data` at the same
time, so a failure inside the swap window is expected and is measured rather
than claimed away.

Run with `scripts/edge-swap-rehearsal.sh <host> <target> <out.md> [attempts]`.

## 2026-09-20T00:01Z — live edge, `ai.investdx.biz.id`

| Field | Value |
| --- | --- |
| Upstream before | `172.30.0.3:20128` (LiteRouter candidate) |
| Upstream after | `172.30.0.2:20128` (9Router) |
| Swap window | 2026-09-20T00:01:25Z → 2026-09-20T00:01:26Z |
| Probes | 6 before + 6 after, `GET /v1/models` |
| Probes reaching a router | 12 / 12 |
| Caddy reload | HTTP 200 |
| Config backup | `/opt/idx/infra/caddy/Caddyfile.bak-swap-ai.investdx.biz.id-1789862484` |

Both sides answered `401` (a router response — the route requires an API key),
so no probe hit a connection error or `5xx`. The upstream was returned to the
candidate immediately after, and `api.investdx.biz.id` was re-checked
(`/healthz` 200; `/internal/stockbit-token` 422, i.e. the ingestor's own body
validation, reached intact).

## Defect found and fixed while rehearsing

The first version of the script read the upstream with a file-wide
`grep reverse_proxy`, so it selected the first site block in the Caddyfile
(`api.investdx.biz.id`'s token handler) and rewrote *that* site to the router
address. Caught by diffing the file against its own backup; `api.investdx`
returned to `ingestor:8083`. The script now derives both the read and the write
from the target host's own block, and the config backup is named per host.

Two lessons carried into Phase 3:

- Reloading Caddy needs the admin API through a sibling container sharing
  `idx-caddy`'s network namespace. `docker exec idx-caddy caddy reload` fails
  with HTTP 403 (origin not allowed), and `docker kill -s USR1` is ignored.
- A swap script must verify it edited the intended site, not just that it edited
  something.

## What this does not prove

This ran while `9router` was still serving from the live volume, so it exercises
the edge flip only. The Phase 3 swap additionally stops the old writer first;
its write window is still unmeasured and is measured by the first production
cutover.

# Single-writer cutover rehearsal (disposable volume)

The edge flip above proves the Caddy half. This is the writer half, run against
a **copy** of `9router-data` in a throwaway volume
(`literouter-cutover-rehearsal-20260920`) so the live volume is never touched.
It is the sequence Phase 3 step 2–3 will run, one writer at a time.

| Step | Result |
| --- | --- |
| Copy live volume → rehearsal volume | `data.sqlite` 26.8 MB, `pragma integrity_check` = `ok` |
| Start old writer (`9router:v0.5.81-kenari-luna`) on the copy | `/api/health` 200, `/v1/models` 401 (router response) |
| Stop old writer | exited; no other container mounts the rehearsal volume |
| Start successor (retired LiteRouter staging image, `REDIS_KEY_PREFIX=literouter:cutover:`) on the same copy | `/api/health` 200, `/v1/models` 401 |
| Successor real provider call (`kn/deepseek-v4-1-flash`, non-streaming) | HTTP 200, `choices[0].message.content` = `"OK"`, `finish_reason` = `stop` |
| Successor streaming call | HTTP 200, SSE deltas observed, exactly one `data: [DONE]` |
| Stop successor, restart old writer | `/api/health` 200 → rollback path viable |

Data parity after the successor had booted and written back:

```text
table                source   after cutover
providerConnections       3   3
apiKeys                   5   5
combos                    4   4
kv                       11   11
usageDaily               26   27   (one row added by the provider call)
usageHistory          50289   50484 (the same provider call was metered)
requestDetails         1000   1000
settings                  1   1
```

The old writer started first, so its counters are the lower bound; the
successor extending them proves it took over the volume as the single writer
rather than starting from a blank database.

## Production cutover, 2026-09-20

Executed once, against the live volume. Ordering as designed: old writer stopped
before the successor started, so no two containers ever mounted `9router-data`.

```text
01:06  preflight backup written and verified (integrity ok, 50689 usage rows)
01:07  guard timer stopped, then running again against the new container
01:07  literouter-production-candidate stopped (last writer of 9router-data)
01:07  literouter started: ghcr.io/.../literouter-production:production-143cc7e3
01:07  edge repointed 172.30.0.3:20128 -> 172.30.0.2:20128, Caddy reload 200
```

Public probe log across the swap (`GET /v1/models`, 100 ms apart): one `502`
lasting ~3 s while the old container was stopped and the new one was not yet
serving, then `401` router responses. **The zero-downtime claim does not hold:**
a client request in flight during that window failed. Zero data loss does hold —
the volume was never written by two processes, `integrity_check` stayed `ok`,
and every retained table count carried over (usageHistory continued from 50689).

Post-cutover verification: `/v1/models` 401 continuously for five minutes;
`kn/deepseek-v4-1-flash` 3/3 `200` with `finish_reason=stop`; SQLite `ok` with
usageHistory 50717; Redis `PONG`; a single container mounts `9router-data`.

Open gap: OpenCode Go could not be exercised on production because no active
`opencode-go` credential exists in the production database; Kenari was used for
the live provider checks.
