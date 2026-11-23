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

| Item | Result |
| --- | --- |
| pending | |

## Performance

| Metric | Node | Bun | Rule | Verdict |
| --- | --- | --- | --- | --- |
| pending | | | | |

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

| OS | Install | Scenario | Result |
| --- | --- | --- | --- |
| pending | | | |

## Soak

| Item | Result |
| --- | --- |
| pending | |

## Rollback rehearsal

| Item | Result |
| --- | --- |
| pending | |

## Cutover

| Item | Result |
| --- | --- |
| pending | |

## Release

| Item | Result |
| --- | --- |
| pending | |
