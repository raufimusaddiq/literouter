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
