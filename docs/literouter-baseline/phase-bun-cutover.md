# Bun cutover evidence

Evidence for the spec §8 cutover gates of the Bun rewrite
(`docs/superpowers/specs/2026-11-22-bun-rewrite-design.md`), produced by Plan 5
(`docs/superpowers/plans/2026-11-22-bun-rewrite-p5-cutover.md`). One section per
gate. A gate counts only with its evidence recorded here.

| Item | Value |
| --- | --- |
| `GATED_MAIN_SHA` | `90ac4b20952622cc42186e3f316d0e093ed425cf` |
| Node baseline image | `ghcr.io/raufimusaddiq/literouter-production:production-90ac4b20952622cc42186e3f316d0e093ed425cf` |
| `staging` head under test | `92d1aa5ed090f04e497fc18c871cd25b2f6eb3bc` |
| Staging image | `ghcr.io/raufimusaddiq/literouter-staging:staging-92d1aa5ed090f04e497fc18c871cd25b2f6eb3bc` (amd64 + arm64) |
| Soak start (Asia/Jakarta) | pending owner |
| Switch hour (Asia/Jakarta) | pending owner |

## Preconditions (Task 0)

Checked on `staging` at `92d1aa5e`, 2026-11-23.

| Check | Result |
| --- | --- |
| Plans 1–4 merged; no open PR into `staging` | yes: #254 `[bun-rewrite p4] complete` merged; `gh pr list --base staging --state open` empty |
| `staging` CI green | yes: Staging Image runs 45156357915 (#254) and 45154897177 (#253) success; CodeQL success |
| `compose.production.yml`: no `node -e` healthcheck, no `NODE_OPTIONS` | yes: healthcheck is `env BUN_BE_BUN=1 /app/literouter -e …`; `NODE_OPTIONS` removed |
| `mem_limit`, `9router-data:/app/data`, `9router` alias on `idx-public` unchanged | yes: `mem_limit: 768m`, volume and alias unchanged vs `main` |
| Staging image pushed for the head, both arches | yes: `docker buildx imagetools inspect` lists `linux/amd64` and `linux/arm64` |
| `Dockerfile` has no `node` stage | yes: `bun` builder, `alpine` runner |
| `package.json` has no `next`; `bun run build`, `bun run compile` exist | yes |

## Merge and freeze

| Item | Value |
| --- | --- |
| `main` commits not in `staging` at gating | 0 (`git log origin/staging..origin/main` empty), so no merge PR was needed |
| Freeze rule | soft freeze (plan Task 1): until the cutover PR merges, `main` takes only fixes production needs; any commit touching `src/ open-sse/ cli/ package.json Dockerfile compose.production.yml` re-runs Parity and Security |
| Drift check before the cutover PR | `git diff --stat 90ac4b20952622cc42186e3f316d0e093ed425cf origin/main -- src open-sse cli package.json Dockerfile compose.production.yml` (empty = no re-run) |
| Suite gate | PASS on `92d1aa5e`: staging push CI run 45156357915, `test / unit`: `bun test`, `verify-no-regression`, `verify-test-counts`, codemod `--check`, eslint, route-table `--check`, parity vs goldens, CLI tests (71 pass), build and bundle smoke. Locally on the same head: `verify-providers` (83 providers), `verify-alias` (122 tokens), `verify-oauth-urls` all byte-for-byte equal |

## Parity

`bun scripts/cutover/parity-images.mjs` runs both images against one host mock:
- the Node image is `production-90ac4b20`, started through `scripts/cutover/node-baseline.sh`;
- the Bun image is built from the fixed tree;
- the seeded data dir and production env are the same for both.

It then runs `tests/parity/compare.mjs` (status, headers, body and SSE framing) and
`tests/parity/compare-upstream.mjs` (the upstream request bytes, with every header).

| Item | Result |
| --- | --- |
| Fixtures | 407 per image. All 125 `routeTable` entries have a fixture, and 32 of them are guard-only (oauth, headroom, pxpipe, deploy, provider validate). |
| Prompt-cache cases (PRD §19.4) | Covered by `zz-cache-00`…`30`: stable system and tools with a growing conversation, first and later turn, `defer_loading` tail, client markers, marker budget at and beyond the cap, varying mid-conversation system block, thinking and redacted thinking, token-saver off, RTK, caveman and ponytail each on its own, account and combo fallback, OpenAI-compatible receiver, and a streaming passthrough |
| `/v1` chat, messages, responses | Stream and non-stream; 401 bad key, 404 unknown model, upstream 429 and 500, mid-stream close, malformed JSON |
| First run (Bun image `staging-92d1aa5e`) | **FAIL.** Upstream request bodies were 0 diffs, byte for byte, but there were 298 response diffs and 260 upstream header diffs (below) |
| After the fixes (PR #255) | Image compare exits 0 with only the 5 ledgered diffs below. Image upstream compare exits 0 with 0 diffs. Source-run compare against the goldens (the CI step) exits 0. |
| `runtime-header-allowlist.json` | `[]`: no header is allowlisted |

Differences found on the first run, and what was done:

| Difference | Fixtures | Fix |
| --- | --- | --- |
| JSON `content-type`: Node `application/json`, Bun `application/json;charset=utf-8` | 291 | `src/server/http.js` answers Node's value |
| Upstream `accept-encoding`: Node `gzip, deflate`, Bun `gzip, deflate, br, zstd` | 62 | The outbound fetch (`open-sse/utils/proxyFetch.js`) fills Node's undici defaults when the caller didn't set the header |
| Upstream `user-agent` (`node` vs `Bun/1.4.4`), `accept-language: *`, `sec-fetch-mode: cors` | 62 | Same fix as `accept-encoding` |
| Upstream `cache-control`/`pragma: no-cache` on `GET /v1/models` | 6 | Same fix; Node's mapping of `cache: "no-store"` |
| Unknown `/api/*` 404 page title | 2 | Matches the Node image's title |
| V8 vs JSC exception text in two `/api` 500 bodies (`api-auth-login-3-bad-json`, `api-settings-database-post-null`) | 2 | **Accepted, ledgered.** The text is engine-specific and can't be matched without emulating V8. Status and shape match, and neither is a `/v1` route |
| `api-auth-login-noauth`: Node 500 (bcryptjs throw), Bun 401 | 1 | **Accepted, ledgered**, as an existing Plan 2 behaviour change (`known-diffs.json`) |

Goldens: `tests/parity/expected/` holds recordings from the Node production image, refreshed by
`scripts/cutover/refresh-goldens.mjs`. Records map by fixture id through `upstream-fixtures.jsonl`.
324 fixtures were refreshed from the Node image. The other 83 fixtures depend on peer locality,
because inside a container the peer is never loopback (`*-lan`, `trust-*`, throttle), or on
production-only env. Those keep their earlier golden, corrected only for the runtime defaults
above. `scripts/cutover/golden-keep.json` lists them with a reason each.

Not exercised by the image-vs-image run: loopback-local behaviour (the 44 `*-lan` fixtures can't
connect to a container on either side). It is covered by the CI source run against the goldens,
and by the Security gate's T1/T9.

## Performance

Node `production-90ac4b20` against Bun `staging-b3a4da447c6e33762f70f08882e56947ffbb83e1` (includes
the parity fixes), measured with `scripts/cutover/measure.mjs` on the dev box (Docker Desktop, WSL2,
4 GB, 2 CPUs). Each container ran with `--memory 768m --cpus 2`, the production env, a fresh copy of
the same seeded data dir and the same host mock. Three rounds alternated Node, Bun ×3, and the
value per side is the median (`perf-gate.mjs --median`). No other container ran during any round
(`docker ps` recorded at each round start). Idle RSS is `VmRSS` of PID 1, taken 60 s after health
as the median of 3 reads 10 s apart. The burst is stream, c20 × 400 with 200 chunks, and post-burst
RSS is read 30 s after it. Latency is non-stream, c1 × 300.

| Metric | Node | Bun | Rule | Verdict |
| --- | --- | --- | --- | --- |
| Idle RSS (MiB) | 115.78 | 57.36 | Bun < Node | PASS |
| Post-burst RSS (MiB) | 123.02 | 89.55 | Bun < Node | PASS |
| p50 latency (ms) | 7.61 | 3.46 | Bun ≤ Node × 1.05 | PASS |
| p95 latency (ms) | 20.21 | 11.24 | Bun ≤ Node × 1.05 | PASS |
| Image bytes, linux/amd64 | | 116 307 046 | ≤ 150 000 000 | PASS |
| Image bytes, linux/arm64 | | 117 759 217 | ≤ 150 000 000 | PASS |

`bun scripts/cutover/perf-gate.mjs node.json bun.json` → `perf gate: pass`, exit 0.

| Round | Node idle / post-burst / p50 / p95 | Bun idle / post-burst / p50 / p95 |
| --- | --- | --- |
| 1 | 115.67 / 122.88 / 7.61 / 20.21 | 56.98 / 89.98 / 3.49 / 11.18 |
| 2 | 115.83 / 124.27 / 8.97 / 22.49 | 57.36 / 89.55 / 3.36 / 13.45 |
| 3 | 115.78 / 123.02 / 6.99 / 18.43 | 57.43 / 89.32 / 3.46 / 11.24 |

Notes:
- The historical 72.3 MiB post-burst figure (`phase-latency-resource.md`) is a reference only, not
  a gate. Bun settles at 89.6 MiB under this heavier burst, and Node at 123.0 MiB under the same one.
- The production image was about 1.03 GB (Phase 1 baseline). The Bun image is 116 MB (amd64).
- The arm64 image was pulled and inspected, not run here. Its start-up smoke ran in CI under QEMU (Plan 4).
- An earlier attempt was discarded, because a CLI test container overlapped round 1.

## Security

Script: `bun scripts/cutover/gates/trust-gates.mjs <image>`. Two topologies: A (Caddy on a
bridge, the `compose.production.yml` shape, peer is a bridge address) and B (Caddy in the app's
network namespace, peer is `127.0.0.1`). Caddyfile uses `trusted_proxies static private_ranges`.
The main pass runs with production's `MINIMAL_PROFILE=true` (so `/api/headroom/*` is 404 before the
guard); `T3-nominimal` and `T8-nominimal` re-check the guard's 403 with it off. T11 makes no
outbound internet call (provider and image hosts are mocks on the bridge).

Run on `ghcr.io/raufimusaddiq/literouter-staging:staging-92d1aa5ed090f04e497fc18c871cd25b2f6eb3bc`: **13/13 PASS**.

| id | Result | Detail |
| --- | --- | --- |
| T1 | PASS | loopback direct: 2/2 not 403 and not 5xx |
| T2 | PASS | loopback via Caddy (B): 2/2 403 |
| T3 | PASS | remote direct: 10/10 403 (404 under `MINIMAL_HIDDEN_PREFIXES`) |
| T4 | PASS | remote direct, spoofed `X-Forwarded-For: 127.0.0.1`: 10/10 403 (404 hidden) |
| T5 | PASS | remote via Caddy (A), spoofed XFF: 10/10 403 (404 hidden) |
| T6 | PASS | loopback direct, `X-Forwarded-For: 203.0.113.9`: 2/2 403 |
| T7 | PASS | `TRUST_LOOPBACK_AS_LOCAL=false`, loopback direct: 2/2 403 |
| T8 | PASS | remote with `x-9r-real-ip`/`x-9r-peer-token`, direct and via Caddy: 20/20 403 (404 hidden) |
| T9 | PASS | loopback direct, `x-9r-real-ip: 8.8.8.8`: 2/2 not 403 |
| T10 | PASS | remote via Caddy, keyless `GET /v1/models`: 401 |
| T11 | PASS | SSRF: public control fetched (1 hit, inlined); link-local, loopback, private bridge host and 302-to-private: 0 hits, nothing inlined |
| T3-nominimal | PASS | 10/10 403 |
| T8-nominimal | PASS | 20/20 403 |
| teardown | PASS | no leftover containers, networks or volumes |

Non-vacuity:
- Node image (`production-90ac4b20`): 9/11 on the first version of the gate; T1 and T9 fail because the Node image never grants a loopback caller local (its trust came from the `custom-server.js` peer token), so T2, T6 and T7 pass vacuously there. Bun grants loopback-local as spec §6.3 requires.
- Mutant with the proxy-marker check disabled: T2 and T6 red. T5 stays green because in topology A the peer is a bridge address and is remote regardless; a second mutant with the loopback-peer check also disabled turns T2, T3, T4, T5, T6, T8 and T10 red.
- Mutant with the SSRF private-address check disabled: T11 red (private bridge host recorded 1 hit, bytes inlined).
- SSRF unit tests (`ssrf-image-security`, `image-fetch-hardening`, `codex-image-fetch`, `ssrf-guard-hardening`, `provider-node-validate-ssrf`, `provider-validate-ssrf`): 90 pass, 0 fail.

To re-run against the production image built from the cutover merge (Task 8 Step 6).

## Dashboard walk-through

Walked on `staging-92d1aa5ed090f04e497fc18c871cd25b2f6eb3bc` (Bun, `127.0.0.1:20195`) side by side
with `production-90ac4b20` (Node, `127.0.0.1:20196`), seeded fixture DB, `TZ=Asia/Jakarta`,
production env. Published ports mean the browser is a remote peer, as in production. Console and
network checked on every page. Result: 0 FAIL, 1 PARTIAL.

| Page / check | Result | Note |
| --- | --- | --- |
| `/` and `/dashboard/*` unauthenticated → `/login`; `/` authed → `/dashboard` | PASS | |
| `/login` wrong password / right password / logout | PASS | error text shown; `auth_token` HttpOnly set; logout clears it |
| `/dashboard` overview | PASS | cold deep link and in-app nav |
| `/dashboard/providers`, `/providers/new`, `/providers/<id>` | PASS | add API-key connection, edit, delete, Test Connection against the mock. Inline "Check" gives 400 `URL not allowed` for a private mock URL from a remote peer (the SSRF/trust gate) |
| OAuth start (Codex) | PASS | redirect leaves for `auth.openai.com`; no login made |
| `/callback` | PARTIAL | renders; completing the code exchange needs a real provider token endpoint (owner) |
| `/dashboard/combos` | PASS | create, add models, reorder, delete |
| `/dashboard/endpoint` | PASS | base URL, key create and copy |
| `/dashboard/quota` | PASS | |
| `/dashboard/usage` | PASS | charts render, period switch, "Times in GMT+7" |
| `/dashboard/console-log` | PASS | stream connected past 60 s; a request after 20 s appeared live |
| `/dashboard/systemone` | PASS | template loads; state survives reload |
| `/dashboard/token-saver` | PASS | toggle persists |
| `/dashboard/profile` | PASS | password change; old rejected, new accepted |
| `/dashboard/settings/pricing` | PASS | |
| Settings → Database, Node export → Bun import | PASS | Bun after: providerConnections 1, apiKeys 1, combos 1, usageHistory 25 |
| Settings → Database, Bun export → Node import | PASS | Node after: providerConnections 1, apiKeys 2, combos 2, usageHistory 25 |
| Timezone | PASS | server and UI labels in Asia/Jakarta |
| Fonts | PASS | bundled IBM Plex Sans and JetBrains Mono, no external font request |
| No GA request with `gaId` unset | PASS | |
| Language switch persists | PASS | `<html lang>` stays `en` after the switch |
| Dark and light themes | PASS | |
| 390 px window | PASS | no horizontal overflow; hamburger nav works |

Differences from the Node image, none a failure:
- Unknown `/dashboard/*` path: Bun answers 200 with the SPA's "Page not found" (spec §6.2: unknown dashboard path → SPA `index.html`); Node answered a real 404.
- Usage details show the provider's display name on Bun, its raw id on Node.
- The Node image renders the body in the system font (its Plex faces stay unloaded); Bun renders the bundled Plex, so some labels are slightly narrower.

Re-walk only the affected pages if later `staging` commits touch `src/web/`.

## CLI matrix

Runner: `bun scripts/cutover/cli-smoke.mjs <start-stop|update-while-running|replace-old-node-server> --spec <tarball>`.
It uses a throwaway `DATA_DIR`, Bun global dir, `HOME` and `APPDATA` under one temp root, and
asserts that the global install resolves inside that root before installing. It uses ports ≥ 20190,
kills only by PID, and snapshots for leaks before teardown.

The "old Node CLI" in §9.8 is this fork's own pre-rewrite CLI (`origin/main` `cli/`, which writes
`server.pid`), staged with `--legacy-src`. The npm package `9router` belongs to the upstream
maintainer. Its `0.5.81` (no pidfile) is tested as a second variant, because users may have had it
installed. Tarballs were packed from the Plan 5 tree with the CLI fixes below.

| OS | Install | start-stop | update-while-running | replace, fork old CLI | replace, upstream `9router@0.5.81` |
| --- | --- | --- | --- | --- | --- |
| Windows 11 | `bun add -g` | PASS | PASS (no EBUSY) | PASS | PASS (taken over) |
| Windows 11 | `bunx` | PASS | PASS | PASS | PASS (taken over) |
| Linux (`oven/bun:1.4.4`, with lsof/procps) | `bun add -g` | PASS | PASS | PASS | PASS (taken over; key check skipped†) |
| Linux, same | `bunx` | PASS | PASS | PASS | PASS (taken over; key check skipped†) |
| Linux (`oven/bun:1.4.4`, no lsof/ps) | `bun add -g` | PASS | PASS | PASS | PASS (taken over; key check skipped†) |
| Linux, same | `bunx` | PASS | PASS | PASS | PASS (taken over; key check skipped†) |
| macOS | | owner | owner | owner | owner |
| Tray (Windows NotifyIcon, macOS/Linux `systray2`) by eye | | owner | | | |

† The upstream old server has no SQLite driver in that container, so the seeded-key survival
check ran on Windows for both variants and on Linux for the fork variant only.

CLI defects the matrix found, fixed on `staging` (Task 6b):
- **Takeover without a pidfile.** A server from the old CLI was missed, and the new CLI started on
  port+1 against the same data dir. Identification now uses the port's live listener, which is
  re-checked before any kill, plus a positive legacy marker: the old cmdline, the `next-server`
  title with a legacy launcher parent or 9router cwd, or `/proc/<pid>/cmdline`. On Linux, Next
  renames the process title to `next-server (vX)`. Anything not positively identified is refused
  with exit 1 and a "stop it yourself" message, and nothing is killed.
- **Open port with an unknown listener.** It no longer falls through to port+1 on the same data
  dir; it refuses with exit 1.
- **`literouter stop` without `lsof`.** On a minimal Linux image it printed "not running", removed
  the pidfile and left the server up. It now looks the listener up with `lsof`, then `ss`, then
  `/proc/net/tcp{,6}` mapped through `/proc/<pid>/fd`. If the pid is alive and the port is open but
  the listener is unknown, it keeps the pidfile and exits 1. This was proven live in a bare
  container.
- CLI tests: 71 → 111 pass.

## Soak

Skipped by the owner's decision (2026-11-23). The DB-compatibility proof the soak's mid-point
check would have given (the Node image opens a DB the Bun build has touched) is part of the
rollback rehearsal below instead. `scripts/cutover/sanitize-soak-db.mjs` is kept. It deactivates
every non-API-key connection in a DB copy, so a copy's refresh tokens can't rotate production's
copy.

## Rollback rehearsal

Run on the production host (`ubuntu@43.129.53.222`) on 2026-11-23, approved by the owner. Production's
`literouter` container and the `9router-data` volume were only read, and every rehearsal object
was a throwaway `lr-rehearsal-*`, all removed afterwards. All rehearsal containers ran on an
`--internal` Docker network (no egress), so nothing on the copy could reach a real provider.

| Item | Value |
| --- | --- |
| Production at the time | container `literouter`, image `production-a6c24a6d66a8d692d43c1e38173b8887813f6810`, healthy; host tree at `30ceec8d` |
| Rollback target | `production-a6c24a6d` (Node, `better-sqlite3`). Migrations 001–005 are identical to `staging`, which differs only by deleted comments in `src/lib/db/schema.js` and `migrations/` |
| Snapshot | `VACUUM INTO` from a read-only connection on `/app/data/db/data.sqlite` (225 MB + 18 MB WAL) into volume `lr-rehearsal-data`; `integrity_check` ok |
| Copy contents | `_meta.schemaVersion=5`, 6 providerConnections, 7 apiKeys, 6 combos, 346 729 usageHistory, 91 usageDaily, 15 000 requestDetails |
| Sanitize | `sanitize-soak-db.mjs`: deactivated 1 OAuth connection, kept 5 API-key connections |

| Step | Result |
| --- | --- |
| A. Bun `staging-b3a4da44` boots on the real-shape copy | `/api/health` 200, driver `bun:sqlite`, 19.9 MiB RSS; SIGTERM → exit 0 |
| A. Copy after Bun | `integrity_check` ok, `journal_mode` wal, every count unchanged |
| A. Node rollback image on the same copy | `/api/health` 200, remote `/v1/models` 401, driver `better-sqlite3`, no DB errors in the log; SIGTERM → exit 0 |
| A. Copy after Node | `integrity_check` ok, wal, every count unchanged |
| B. Mock provider imported through `POST /api/settings/database` (CLI token) on Bun | 200 `{"success":true}` |
| B. Bun: keyless `/v1/models`; non-stream and stream chat to the mock | 401; 200; 200 with exactly one `data: [DONE]` |
| B. Node rollback image on the same copy, same calls | 401; 200; 200 with exactly one `data: [DONE]` |
| B. Final copy | `integrity_check` ok; usageHistory +2, one row written under Bun and one under Node, the same per-image behaviour |
| `deploy.sh` accepts the Node tag as a rollback target | yes: it takes any `production-<40 hex>`; `tests/unit/deploy-script.test.js` covers keeping the replaced tag on failed health or endpoint |

Rollback procedure: check out the old tree with `git -C /home/ubuntu/9router checkout a6c24a6d66a8d692d43c1e38173b8887813f6810`,
which restores the Node-era `compose.production.yml` with the `node -e` healthcheck. Then run
`bash scripts/deploy.sh a6c24a6d66a8d692d43c1e38173b8887813f6810`. Never restore a backup over the volume:
the DB stays compatible in both directions.

Image size as the host reports it: this host uses the containerd snapshotter, where
`docker image inspect .Size` counts the image differently. There it shows the Bun image at 354 MB
and the Node production image at 1.11 GB. The 150 MB gate (see Performance) uses the classic store
on the dev box and in CI.

## Cutover

| Item | Result |
| --- | --- |
| pending | |

## Release

| Item | Result |
| --- | --- |
| pending | |
