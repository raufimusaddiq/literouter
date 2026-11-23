# Bun Rewrite — Plan 5: Parity Gates and Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the `staging` Bun build is a drop-in replacement for `main`'s Node image, switch production to it with a one-command rollback, release the `literouter` CLI, and delete the transition scaffolding.

**Architecture:** Gates are scripts under `scripts/cutover/` that compare the current production-equivalent Node image (built from `main`) with the `staging-<sha>` image, using Plan 2's parity harness and the existing `scripts/bench/` tools. Results go into one evidence doc, `docs/literouter-baseline/phase-bun-cutover.md`, in the same style as the existing `phase-*.md` files. The deploy reuses `scripts/deploy.sh`, `scripts/edge-swap-rehearsal.sh` and the single-writer rule from `production-promotion-plan.md`. It adds a soak on a sanitized copy of the production DB and a rehearsed rollback before the real switch.

**Tech Stack:** Bun 1.4.4 (`bun test`, `bun:sqlite`), Docker (buildx, amd64 and arm64), Caddy 2, bash for host scripts, `gh` for PRs and releases.

**Spec:** `docs/superpowers/specs/2026-11-22-bun-rewrite-design.md` (§4 anti-goals, §7 working on `staging`, §8 cutover gates, §9 items 6–8). Cross-plan names: `docs/superpowers/plans/2026-11-22-bun-rewrite-00-index.md`. Plan 1's "Merge procedure for `main → staging`" is reused.

## Reconciliation (2026-11-23): these points override the task text below

The index contract (`2026-11-22-bun-rewrite-00-index.md`) takes precedence over this plan.

- **Owned elsewhere:** the parity-harness additions this plan relies on (the `upstream-requests.jsonl` capture, `tests/parity/seed.mjs`, small normalised outputs) are owned by Plan 2 Task 1. The `compose.production.yml` healthcheck and the `NODE_OPTIONS` removal are owned by Plan 4 Task 7. The CLI `stop` command is owned by Plan 4. Task 0 verifies all of them before anything else runs.
- **Compression:** Plan 2 keeps gzip parity, so the parity run expects `content-encoding` to match Node's.
- **Staging image:** `ghcr.io/raufimusaddiq/literouter-staging:staging-<sha>`.
- **Outward-facing steps:** every one is marked **[OWNER OK]**: DNS, deploy, the `staging → main` merge, the image switch, `bun publish`, `npm deprecate`, the `v*` tag. Ask the owner at the moment of each step, not up front.

## Global Constraints

- **Every deploy, push, publish, tag, deprecate or production step is outward-facing and needs the owner's explicit OK at that moment.** Steps marked **[OWNER OK]** stop and ask first. A standing approval, an earlier "go", or a green gate is not that OK. Never run them from a script that was started earlier.
- No `node` binary anywhere in CI, the Docker image, the CLI or repo scripts. Exception: the one-off final `9router` release (Task 9), which comes from the old Node CLI source and uses `npm`.
- No DB schema change. A DB touched by the Bun build must open in the Node image and the reverse. Rollback is "swap the image back", never "restore a backup over the volume" (`pr-merge-runbook.md`, "Failed deploy: roll forward").
- Single writer: the old and the new container never mount `9router-data` at the same time. The soak runs on a copy in its own volume.
- Production host rule from `pr-merge-runbook.md`: do not install dependencies, build or run test suites on the production host. All builds and gates run on the dev box or in CI. The host only pulls images, runs `docker`/`compose`, and runs `scripts/deploy.sh`.
- Bun pinned to **1.4.4**. Image gate: **at most 150 MB** (`docker image inspect --format '{{.Size}}'` ≤ 150 000 000 bytes) for **both** `linux/amd64` and `linux/arm64`.
- Trust model unchanged (spec §4): through Cloudflare → Caddy → app, a request is **remote**.
- Conventional Commits. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PRs follow the rig auto-merge flow: PR, `gh pr merge --auto --merge`, required checks `unit` and `Hermes Review`, merge commits only; reviewer feedback goes to a respawned worker.
- Delegated or subagent work runs on **Sonnet 5.5** (`model: "sonnet"`).

## Review Focus

1. **Runtime-injected upstream headers.** Node's `fetch` (undici) and Bun's `fetch` add different default headers (`user-agent`, `accept-encoding`, `accept-language`, `sec-fetch-mode`, `connection`). A byte-comparison would fail on noise, but a blanket ignore could hide a real change, such as Bun asking an upstream for `zstd`. Task 2 compares the upstream request body bytes plus every header, with a short reviewed allowlist. A test pins that an unlisted header difference fails.
2. **Refresh-token rotation from the DB copy.** If the soak container refreshes an OAuth token from the copied DB, the provider rotates it and production's copy is invalidated. Task 7 deactivates every non-API-key connection in the copy before first boot, and a test pins it.
3. **`deploy.sh` deletes the tag it replaced.** After a successful cutover the Node image would be untagged locally, which is the rollback image. Task 8 adds a second local tag first and checks it exists.
4. **Prod peer is not loopback.** In `compose.production.yml` Caddy reaches the app over the `idx-edge` bridge (`172.30.0.2`), so the peer is a bridge address, not `127.0.0.1`. The spec's "loopback + Caddy XFF" case is the host-Caddy topology. Task 4 tests both topologies.
5. **Silent streams through Caddy and Cloudflare.** Bun's default idle timeout is 10 s, and a slow first byte can be much longer. Task 7's soak includes a stream with a 30 s first-byte delay through Caddy, and it must end with exactly one `[DONE]`.

Also pinned by tests: main drifting after the gated run (Task 1), and the merge commit's tree not matching the tested `staging` tree (Task 8).

---

## File structure

| Path | Responsibility |
|---|---|
| `docs/literouter-baseline/phase-bun-cutover.md` | The evidence doc. One section per gate, filled as gates run. Task 0 creates the skeleton. |
| `scripts/cutover/node-baseline.sh` | Pull and run the production-equivalent Node image for a `main` SHA. Transition-only; removed in Task 10. |
| `scripts/cutover/perf-gate.mjs` | `evaluatePerf(...)` plus a CLI that compares two measurement files. |
| `scripts/cutover/measure.mjs` | Measures idle RSS, post-burst RSS and latency for one running container. |
| `scripts/cutover/sanitize-soak-db.mjs` | Deactivates refreshable connections in the DB copy. |
| `scripts/cutover/gates/{compose.yml,Caddyfile,trust-gates.mjs}` | Local Caddy in front of the staging image, and the trust-model probes. |
| `scripts/cutover/cli-smoke.mjs` | One-OS CLI scenario runner for the matrix. |
| `tests/parity/compare-upstream.mjs`, `tests/parity/runtime-header-allowlist.json` | Byte-exact comparison of captured upstream requests. |
| `tests/unit/cutover-*.test.js` | Unit tests for the three scripts above that contain logic. |

Contract requests on Plan 2's harness are listed in Task 2 (the mock upstream captures raw requests) and Task 3 (a DB seeding entry point). If Plan 2 already provides them under another name, use that name and fix the references here, not the other way round.

---

### Task 0: Preconditions and the evidence doc

**Files:**
- Create: `docs/literouter-baseline/phase-bun-cutover.md`

- [ ] **Step 1:** Confirm Plans 1–4 are merged on `staging` and `staging` CI is green. Run `gh pr list --base staging --state open` (expected: none) and `gh run list --branch staging --limit 3`.
- [ ] **Step 2:** Confirm these facts on `staging` and record the answers in the evidence doc. Any "no" is a Plan 2–4 defect to fix on `staging` first, not to work around here:
  - `compose.production.yml` has no `node -e` healthcheck and no `NODE_OPTIONS`. The healthcheck works inside the compiled image, `mem_limit` and the `9router-data:/app/data` mount are unchanged, and the `9router` alias on `idx-public` is unchanged.
  - The image workflow pushed `ghcr.io/raufimusaddiq/literouter-staging:staging-<sha>` for the current `staging` head, and `docker buildx imagetools inspect` shows both `linux/amd64` and `linux/arm64`.
  - `Dockerfile` has no `node` stage. `package.json` has no `next` entry, and `bun run build` and `bun run compile` exist.
- [ ] **Step 3:** Create the evidence doc with these sections, each holding a results table to be filled: Merge and freeze, Parity, Performance, Security, Dashboard walk-through, CLI matrix, Soak, Cutover, Rollback rehearsal, Release.
- [ ] **Step 4:** Ask the owner for the cutover window: the soak start date and a low-traffic hour for the switch (Asia/Jakarta). Write both into the doc.
- [ ] **Step 5:** Commit: `docs: add bun cutover evidence doc skeleton`.

### Task 1: Final `main` → `staging` merge and the freeze

**Files:**
- Modify: `docs/literouter-baseline/phase-bun-cutover.md` (Merge and freeze)

**Decision: soft freeze, not a locked `main`.** The rig flow keeps merging to `main`, and locking it for a multi-day soak would stall unrelated tickets. The rule instead:
- From the final merge until the cutover PR merges, `main` accepts only fixes that production needs.
- Every `main` commit that touches `src/`, `open-sse/`, `cli/`, `package.json`, `Dockerfile` or `compose.production.yml` is merged into `staging` the same day, and it invalidates the parity and security results recorded before it. Those two gates (Tasks 2 and 4) are scripted and take minutes, so they re-run.
- Commits that touch only `docs/`, `tests/` or `CHANGELOG.md` do not invalidate gates. They are still merged into `staging`.

- [ ] **Step 1:** On a clean `staging` checkout: `git fetch origin && git merge origin/main`. Resolve conflicts. Changes under `src/app/api/**` or `src/app/**/page.js` on `main` must be re-ported to `src/server/` or `src/web/pages/` by hand. A `main` change to `next.config.mjs` goes into `src/server/routes.js`.
- [ ] **Step 2:** `bun scripts/migrate-vitest-to-bun.mjs tests`, which is Plan 1's codemod re-run on the vitest-style files that came in. Then `bun scripts/migrate-vitest-to-bun.mjs --check tests` must exit 0.
- [ ] **Step 3:** Run the route-manifest drift test from `tests/server/` (Plan 2). Expected: PASS. If it fails, a new `main` route has no Bun entry: add it to `routeTable`, with the manifest's `source` path.
- [ ] **Step 4:** `cd tests && bun test --parallel --reporter=junit --reporter-outfile=../test-results.xml`. Then run `bun tests/__baseline__/verify-no-regression.mjs test-results.xml`, `bun tests/__baseline__/verify-test-counts.mjs test-results.xml`, and the four `bun tests/__baseline__/verify-{providers,alias,oauth-urls}.mjs` scripts. The CI-side steps (eslint, `git diff --exit-code -- tests`) come from the PR check.
- [ ] **Step 5:** Open a PR into `staging` named `chore: merge main into staging (pre-cutover)`, following the rig flow. Record the merge SHA as `GATED_MAIN_SHA` in the evidence doc. This is the `main` commit all later gates are measured against.
- [ ] **Step 6:** Write down the drift check to run before the cutover PR (used again in Task 8): `git diff --stat $GATED_MAIN_SHA origin/main -- src open-sse cli package.json Dockerfile compose.production.yml`. Empty output means no re-run is needed.

### Task 2: Differential parity run

**Files:**
- Create: `scripts/cutover/node-baseline.sh`
- Create: `tests/parity/compare-upstream.mjs`, `tests/parity/runtime-header-allowlist.json`
- Test: `tests/unit/cutover-compare-upstream.test.js`
- Modify (only if Plan 2's mock lacks it): `tests/parity/mock-upstream.js`

**Interfaces:**
- Consumes: `tests/parity/record.mjs <baseUrl> <outDir>`, `tests/parity/compare.mjs <expectedDir> <actualDir>`, `tests/parity/fixtures/*.json`, `tests/parity/mock-upstream.js` (Plan 2).
- Contract request on the mock upstream: it appends every request it receives to `<outDir>/upstream-requests.jsonl`, one line per request: `{ "seq": n, "method": string, "path": string, "headers": [[name, value], ...], "bodyBase64": string }`. The headers are in wire order and the body is the raw bytes, not parsed JSON. Plan 2's `record.mjs` already owns `outDir`, so the file sits next to the recorded responses.
- Produces: `compareUpstream(expected: UpstreamRecord[], actual: UpstreamRecord[], allowlist: string[]) → { ok: boolean, diffs: string[] }`. CLI: `bun tests/parity/compare-upstream.mjs <expectedDir> <actualDir>`, exit 1 on any diff.
  - Records are matched by `seq`. A different record count is a diff.
  - Bodies are compared as bytes, and `content-length` is compared as a header.
  - Header names are lower-cased. Values are compared exactly. Header order is ignored, because it does not affect upstream caching.
  - A difference in a header named in `runtime-header-allowlist.json` is ignored. Any other difference is reported as `seq N header <name>: expected <v>, actual <v>`.
- `runtime-header-allowlist.json` starts as `["user-agent", "accept-encoding", "accept-language", "sec-fetch-mode", "connection"]`. Each later addition needs a one-line reason in the file and the owner's agreement.

- [ ] **Step 1: Write the failing tests** in `tests/unit/cutover-compare-upstream.test.js`:
  - `"identical bodies and headers pass"`.
  - `"a one-byte body difference fails"` using bodies `{"cache_control":{"type":"ephemeral","ttl":"1h"}}` vs `... "ttl":"5m"`.
  - `"key order in the body is a difference"`, because bytes, not JSON-equal.
  - `"allowlisted user-agent difference is ignored"`.
  - `"unlisted anthropic-beta difference fails"`, and the diff string names `anthropic-beta`.
  - `"extra or missing upstream request fails"`.
  - `"header order alone is not a difference"`.
- [ ] **Step 2:** `cd tests && bun test unit/cutover-compare-upstream.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement `compareUpstream` and the CLI. Decode `bodyBase64` and compare with `Buffer.compare`.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5:** Verify that the Plan 2 fixtures cover the prompt-cache cases. They must include, at least, the PRD §19.4 list: stable system plus tools plus a growing conversation, a first turn with no assistant history, `defer_loading` tools at the tail, client-supplied `cache_control`, requests at and beyond the marker budget, a varying mid-conversation system block, thinking enabled, token-saver off, and each RTK or body transform on its own. Source of the list: `git show origin/docs/literouter-v2-architecture-prd:docs/literouter-v2-architecture-prd.md`, §19.4. Add any missing fixture to `tests/parity/fixtures/` and re-record. Also check that every `/api` route in `routeTable`, `/v1/chat/completions`, `/v1/messages` and `/v1/responses` (each stream and non-stream) and the error cases (401 bad key, 404 unknown model, upstream 429, upstream 500, upstream closes mid-stream, malformed JSON) have a fixture. The gate is `routeTable.length` routes all covered, listed in the evidence doc.
- [ ] **Step 6:** Write `scripts/cutover/node-baseline.sh <full-main-sha> <port> <data-dir>`. It runs `docker pull ghcr.io/raufimusaddiq/literouter-production:production-<sha>` and then `docker run -d --name lr-node-<port> -p 127.0.0.1:<port>:20128 -v <data-dir>:/app/data --add-host host.docker.internal:host-gateway` with the same env as `compose.production.yml`, minus Redis. Use the image published for `GATED_MAIN_SHA` or `main`'s tip. A pulled image is the real production artifact, so there is no local Node build.
- [ ] **Step 7:** Seed one fixture data dir, copy it to two (`/tmp/lr-parity-node`, `/tmp/lr-parity-bun`), and start both containers on the same mock upstream: Node from `node-baseline.sh`, Bun from `ghcr.io/raufimusaddiq/literouter-staging:staging-<sha>` with the same env, `TZ`, and `--memory 768m`.
- [ ] **Step 8:** `bun tests/parity/record.mjs http://127.0.0.1:<node-port> parity-out/node`, then the same for `<bun-port>` into `parity-out/bun`. Run `bun tests/parity/compare.mjs parity-out/node parity-out/bun` and `bun tests/parity/compare-upstream.mjs parity-out/node parity-out/bun`. Expected: both exit 0.
- [ ] **Step 9:** Triage every difference as a Bun bug (fix on `staging`, re-run from Step 7), an accepted runtime-header difference (allowlist, with reason and owner agreement), or a fixture flake (normalise in `compare.mjs`). Never "accept" a body, status, SSE framing or cache-relevant header difference. Pay particular attention to `accept-encoding`: if Bun's outgoing value differs from Node's and an upstream behaves differently on it, set it explicitly in `open-sse/` rather than allowlisting.
- [ ] **Step 10:** Paste the result table (fixtures run, diffs, allowlisted headers with reasons) into the evidence doc. Commit: `test: byte-exact upstream request comparison for parity gate`.

### Task 3: Performance gates

**Files:**
- Create: `scripts/cutover/perf-gate.mjs`, `scripts/cutover/measure.mjs`
- Test: `tests/unit/cutover-perf-gate.test.js`

**Interfaces:**
- Consumes: `runBench({ baseUrl, key, model, mode, concurrency, requests, maxTokens, label }) → { report, results }` from `scripts/bench/run.mjs` (`results[].totalMs`), `percentile(values, p)` from `scripts/bench/stats.mjs`, and `startMock` from `scripts/bench/mock-upstream.mjs`.
- Contract request on Plan 2: a way to seed a data dir with a provider node pointing at the mock plus an API key, without the dashboard API, since a container's peer is never loopback. The name is `tests/parity/seed.mjs <dataDir> --upstream <baseUrl> --print-key`, which prints the API key. If Plan 2 named it differently, use that.
- Produces:
  - `type Measure = { rssIdleMiB: number, rssPostBurstMiB: number, p50Ms: number, p95Ms: number, imageBytes?: { amd64?: number, arm64?: number } }`
  - `evaluatePerf({ node: Measure, bun: Measure }) → { pass: boolean, failures: string[] }`
  - CLI: `bun scripts/cutover/perf-gate.mjs <node.json> <bun.json>`. It prints failures and exits 1 on any.
  - Rules, each a named failure:
    - `rssIdleMiB`: Bun strictly lower than Node.
    - `rssPostBurstMiB`: Bun strictly lower than Node.
    - `p50Ms` and `p95Ms`: Bun ≤ Node × 1.05. The 5% is bench noise, chosen here, and the spec's "no worse" is read as "not worse beyond noise".
    - `imageBytes`: each present arch ≤ 150 000 000, and **both** arches are required for Bun.
- `scripts/cutover/measure.mjs <containerName> <baseUrl> <key> <model> <out.json>` produces a `Measure`:
  - Idle RSS: wait 60 s after the health check passes, then read `VmRSS` from `docker exec <c> cat /proc/1/status`. Take the median of 3 reads 10 s apart.
  - Burst: `runBench` with `mode: "stream"`, `concurrency: 20`, `requests: 400`, against the mock with `chunks: 200` (same shape as section c of `mock-suite.mjs`).
  - Post-burst RSS: read 30 s after the burst ends, because the historical figure of 72.3 MiB (`phase-latency-resource.md`) was a settled value, and it is kept only as a sanity reference, not a gate.
  - Latency: `runBench` with `mode: "nonstream"`, `concurrency: 1`, `requests: 300`, mock fast on port 9101. `p50Ms` and `p95Ms` come from `percentile(results.map(r => r.totalMs), 50|95)`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/cutover-perf-gate.test.js`:
  - `"passes when bun is lower on RSS and equal on latency"`.
  - `"fails when idle RSS is equal"` (strictly lower is required).
  - `"fails when post-burst RSS is higher"`.
  - `"p95 within 5% passes, 6% fails"` (node 20.0 ms: bun 20.9 passes, 21.2 fails).
  - `"fails when only amd64 image size is given"`.
  - `"fails at 150000001 bytes, passes at 150000000"`.
- [ ] **Step 2:** `cd tests && bun test unit/cutover-perf-gate.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement `evaluatePerf` and the CLI in `scripts/cutover/perf-gate.mjs`.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5:** Implement `measure.mjs` as specified above. It records nothing about keys in its output.
- [ ] **Step 6:** Run the measurement on the dev box under identical conditions: Node image from `node-baseline.sh`, Bun image from `staging-<sha>`, both with `--memory 768m --cpus 2`, the same seeded data dir copy, the same host mock. Alternate Node, Bun, Node, Bun, Node, Bun and take the median per metric across the three rounds. Docker Desktop on Windows is noisy in absolute terms, so only the comparison counts.
- [ ] **Step 7:** Image size per arch: `docker buildx imagetools inspect` to find both digests, then for each of amd64 and arm64 `docker pull --platform linux/<arch>` and `docker image inspect --format '{{.Size}}'`. arm64 on the amd64 dev box is only pulled and inspected here, not run. Its start-up smoke ran in CI under QEMU (Plan 4).
- [ ] **Step 8:** `bun scripts/cutover/perf-gate.mjs node.json bun.json`. Expected: exit 0. A failure is a Bun regression to fix on `staging`, or, for RSS only, a conversation with the owner about the baseline.
- [ ] **Step 9:** Paste both `Measure`s and the verdict into the evidence doc. Commit: `test: perf gate comparing node and bun images`.

### Task 4: Security gates (trust model behind Caddy)

**Files:**
- Create: `scripts/cutover/gates/compose.yml`, `scripts/cutover/gates/Caddyfile`, `scripts/cutover/gates/trust-gates.mjs`

**Interfaces:**
- `trust-gates.mjs <image>` starts the stack, runs every case below, prints one line per case (`PASS|FAIL <id> <detail>`) and exits 1 on any failure. It always tears the stack down.
- Topology A, "prod bridge": `app` (the image) and `caddy` on one user-defined bridge network. Caddy has `reverse_proxy app:20128`. This is the `compose.production.yml` shape, where the app's peer is a bridge address.
- Topology B, "host Caddy": `caddy` uses `network_mode: "service:app"` and proxies to `127.0.0.1:20128`, so the app's peer is `127.0.0.1`. This is the spec's "loopback plus Caddy XFF" case.
- The Caddyfile mirrors production: `servers { trusted_proxies static private_ranges }` so that a client address in a private range is treated like Cloudflare, with Caddy appending to `X-Forwarded-For` and setting `X-Forwarded-Proto` and `X-Forwarded-Host`.
- Callers: `client-remote` is a `curlimages/curl` container on the bridge, `client-loopback` is a `curlimages/curl` container started with `--network container:<app>` (the same sibling-container pattern `edge-swap-rehearsal.sh` uses for Caddy's admin API).
- Probe paths. Local-only: every path in the guard's local-only list (`/api/oauth/cursor/auto-import`, `/api/oauth/kiro/auto-import`, `/api/auth/reset-password`, `/api/headroom/{start,stop,proxy,restart}`, `/api/pxpipe/{install,start}`, and POST `/api/headroom/extras`), from `src/dashboardGuard.js` lines 67–80. Keep the list in `trust-gates.mjs` and let `tests/unit/dashboard-guard.test.js` stay the owner of the source of truth. Local-allowed probe: `GET /api/oauth/cursor/auto-import` and `GET /api/oauth/kiro/auto-import` only. `reset-password` and the `headroom`/`pxpipe` mutators are probed only for the remote 403, never from a local caller, because a local caller would execute them.

| id | Caller → route | Expect |
|---|---|---|
| T1 | `client-loopback` → `app:20128` direct, local-allowed probe | not 403 (local) |
| T2 | `client-loopback` → Caddy (topology B), same probe | 403 (loopback peer plus proxy markers is remote) |
| T3 | `client-remote` → `app:20128` direct, all local-only paths | 403 each |
| T4 | `client-remote` → `app:20128` with `X-Forwarded-For: 127.0.0.1`, all local-only paths | 403 each (spoofed XFF from a non-loopback peer ignored) |
| T5 | `client-remote` → Caddy (topology A) with `X-Forwarded-For: 127.0.0.1`, all local-only paths | 403 each |
| T6 | `client-loopback` → `app:20128` with `X-Forwarded-For: 203.0.113.9`, local-allowed probe | 403 (any proxy marker on a loopback peer means remote) |
| T7 | app restarted with `TRUST_LOOPBACK_AS_LOCAL=false`; `client-loopback` direct, local-allowed probe | 403 |
| T8 | `client-remote` direct and via Caddy with `x-9r-real-ip: 127.0.0.1` and `x-9r-peer-token: x`, all local-only paths | 403 each |
| T9 | `client-loopback` direct with `x-9r-real-ip: 8.8.8.8`, local-allowed probe | not 403 (the header is meaningless now, so it neither grants nor removes locality) |
| T10 | `client-remote` → Caddy, unauthenticated `GET /v1/models` | 401 (keyless `/v1` is not local-trusted) |
| T11 | SSRF pin: a mock "image host" on the bridge. `POST /v1/chat/completions` with an `image_url` to a private address (`http://169.254.169.254/x.png`, `http://127.0.0.1:<mock>/x.png`) and with a URL that answers `302` to the mock | the mock records **0** hits for the private and redirect targets, and the request fails cleanly |

For T11, use the request shape that `tests/unit/codex-image-fetch.test.js` and `ssrf-image-security.test.js` use to reach the fetch. In addition, the existing SSRF unit tests (`ssrf-image-security`, `image-fetch-hardening`, `codex-image-fetch`, `ssrf-guard-hardening`, `provider-node-validate-ssrf`, `provider-validate-ssrf`) are part of the gate and must pass in the `staging` CI run.

- [ ] **Step 1:** Write `compose.yml`, `Caddyfile` and `trust-gates.mjs`. Start with T3 and T4 (the cheapest). Verify each probe works first against the Node image from `node-baseline.sh` (`trust-gates.mjs <node-image>` is expected to fail only on T8's and T9's assumptions about old headers, since the Node build still honours `x-9r-*` from its own wrapper). That proves the probes are real and not vacuous.
- [ ] **Step 2:** Run `bun scripts/cutover/gates/trust-gates.mjs ghcr.io/raufimusaddiq/literouter-staging:staging-<sha>`. Expected: all PASS.
- [ ] **Step 3:** Mutation check: temporarily run the same probes against a build with the proxy-marker check disabled (a local, uncommitted edit, rebuilt through `bun run build`), and confirm T2, T5 and T6 go red. Discard the edit. This proves the gate can fail.
- [ ] **Step 4:** Paste the result table into the evidence doc. Commit: `test: trust-model gates against a prod-shaped Caddy`.

### Task 5: Dashboard walk-through

**Files:**
- Modify: `docs/literouter-baseline/phase-bun-cutover.md` (Dashboard walk-through)

No script: the pages are interactive and the spec requires a person to walk them. Use a browser against the staging image on the dev box with the seeded fixture DB, and the DevTools console open. Each row is `PASS`, or `FAIL` with the console error or screenshot.

- [ ] **Step 1:** Walk each of these. For every page: loads from a cold deep link (SPA fallback), loads by in-app navigation, no console errors or failed network requests, and the layout matches `main` side by side.
  - `/` redirects to `/dashboard`. Unauthenticated `/dashboard/*` redirects to `/login`. `/login`: wrong password shows the error, right password sets the cookie. Logout clears it.
  - `/dashboard` (overview). `/dashboard/providers` (list), `/dashboard/providers/new`, `/dashboard/providers/<id>` (detail: add an API-key connection, test a connection, edit and delete).
  - OAuth flows: start one (for example Codex or Claude), confirm the redirect leaves for the provider, and that `/callback` renders and completes using a seeded or mocked callback. A real login is optional and needs the owner.
  - `/dashboard/combos` (create, reorder, delete), `/dashboard/endpoint` (base URL, key create and copy), `/dashboard/quota`, `/dashboard/usage` (charts render, period switch), `/dashboard/console-log` (stream connects and stays connected past 20 s), `/dashboard/systemone` (a template loads, the form state survives a reload), `/dashboard/token-saver`, `/dashboard/profile` (password change), `/dashboard/settings/pricing`.
  - Settings → Database: export from the Node image imports into the Bun image, and the reverse. Compare the row counts of `providerConnections`, `apiKeys`, `combos`, and `usageHistory`.
- [ ] **Step 2:** Cross-cutting checks: the timezone shown equals `Asia/Jakarta` and matches the server's day keys (T-43). Fonts are the bundled IBM Plex Sans and JetBrains Mono (no network font request). No Google Analytics request when `gaId` is unset. Language switch persists. Dark and light themes both render. A narrow window (about 390 px) is usable.
- [ ] **Step 3:** Fix each failure on `staging` and re-walk only the affected pages. Record the walked commit SHA in the evidence doc. If later `staging` commits touch `src/web/`, re-walk the affected pages.

### Task 6: CLI matrix

**Files:**
- Create: `scripts/cutover/cli-smoke.mjs`
- Modify: `docs/literouter-baseline/phase-bun-cutover.md` (CLI matrix)

**Interfaces:**
- `bun scripts/cutover/cli-smoke.mjs <scenario> [--spec <npm-spec-or-tarball>]` for scenarios `start-stop`, `update-while-running`, `replace-old-node-server`. It prints `PASS|FAIL <step>` lines and exits 1 on any failure. It uses `Bun.spawn`, the CLI's `--port`, `--no-browser` and `--skip-update` flags and `GET /api/health`. It uses a throwaway `DATA_DIR` and a non-default port, never `~/.9router` or 20128.
- Pre-publish, `--spec` is a tarball from `bun pm pack` in the CLI package directory. Post-publish, it is `literouter@<version>`.

- [ ] **Step 1:** Implement the three scenarios:
  - `start-stop`: `bun add -g <spec>`, run `literouter --port 20190 --no-browser --skip-update`, wait for `/api/health` 200, run the CLI's stop path (use the documented command from Plan 4's README), and verify the port is closed and the pidfile is gone.
  - `update-while-running`: with the server up from version A, run `bun add -g <spec B>` (a higher version, packed from the same tree with a bumped patch). Expected: exit 0 with no `EBUSY`/`EPERM`, then a restart serves version B.
  - `replace-old-node-server`: install `9router@0.5.81` with `npm i -g` (Node is acceptable on the test machine for the old package), start it on the port, then start `literouter` on the same data dir and port. Expected: the old server is stopped first, the new one answers `/api/health`, and the data (a seeded API key) survives.
- [ ] **Step 2:** Run on all three OSes: Windows 11 (the dev box), macOS and Linux (a VM or CI runner; ask the owner for access to a Mac). Rows: OS × `bun add -g literouter` × `bunx literouter` × the three scenarios. Plus the tray, checked by eye: it appears, its menu works (open dashboard, quit), and quitting stops the server. On Windows it is the PowerShell NotifyIcon. On macOS and Linux, check that `systray2` installs into `~/.9router/runtime` through `bun add` and runs under Bun.
- [ ] **Step 3:** Paste the matrix into the evidence doc. Any failure goes back to the Plan 4 CLI code on `staging` and the OS row re-runs. Commit: `test: cli smoke scenarios for the cutover matrix`.

### Task 7: Side-by-side deploy and soak

**Files:**
- Create: `scripts/cutover/sanitize-soak-db.mjs`
- Test: `tests/unit/cutover-sanitize-soak-db.test.js`
- Create (on the host, not committed): `/home/ubuntu/9router/soak/{compose.soak.yml,.env.soak}` and one extra Caddy site block.

**Interfaces:**
- `sanitizeSoakDb(dbPath: string) → { deactivated: number, kept: number }` using `bun:sqlite`. It sets `isActive = 0` on every `providerConnections` row whose `authType` is not `apikey`, `api_key` or `none`, and leaves other rows untouched. CLI: `bun scripts/cutover/sanitize-soak-db.mjs <dbPath>`.

**Decisions.**
- **Soak window: 72 hours**, with at least two local midnights in `Asia/Jakarta`, so the daily rollups and day-key boundaries (T-43) run under real clocks, and with one full weekday traffic cycle on the copy's data.
- **Where:** on the production host as a second container `literouter-soak`, a different volume `literouter-soak-data`, host port `127.0.0.1:20129`, and a separate hostname through Caddy (for example `ai-soak.musaddiqr.com`, which needs a DNS record: the owner's call, and a loopback-only Caddy site plus an SSH tunnel is the fallback). Never the live `9router-data` volume.
- **Memory headroom:** the host has about 3.7 GiB available with exhausted swap (compose comment), so the soak container gets `mem_limit: 256m`. Check `docker stats` first. If production is under pressure, stop the soak, not production.
- **Traffic:** the soak serves synthetic traffic to a mock provider node added to the copy (a one-request-per-second trickle with `scripts/bench/run.mjs --duration`), not mirrored production traffic. Real providers are used only for the owner-approved smoke below. All OAuth connections are deactivated, so no refresh token can rotate.
- Same env as `compose.production.yml`, except `REDIS_KEY_PREFIX=literouter:soak:`, `DISABLE_BACKGROUND_TOKEN_REFRESH=true`, and `MODEL_CATALOG_SYNC=off`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/cutover-sanitize-soak-db.test.js`, on a temp SQLite file with the columns `id, provider, authType, isActive, data`:
  - `"deactivates oauth, cookie and access_token connections"`.
  - `"keeps apikey, api_key and none connections active"`.
  - `"returns counts and is idempotent"`.
  - `"throws on a missing providerConnections table"` (so a wrong file does not pass silently).
- [ ] **Step 2:** `cd tests && bun test unit/cutover-sanitize-soak-db.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement `sanitizeSoakDb`. Open with `{ readwrite: true }` only, never `create`.
- [ ] **Step 4:** Same command. Expected: PASS. Commit: `test: sanitize prod db copy for soak`.
- [ ] **Step 5 [OWNER OK]:** Take a consistent snapshot of the live DB without stopping the app: run a sibling container that mounts `9router-data` and calls `sqlite3 /data/data.sqlite ".backup '/out/soak.sqlite'"`, with `/out` as the new `literouter-soak-data` volume. This only reads the live volume. Then `PRAGMA integrity_check` on the copy must return `ok`, and the row counts of `providerConnections`, `apiKeys`, `combos`, and `usageHistory` must be recorded. Never copy the file with `cp` while the WAL is live.
- [ ] **Step 6:** `bun scripts/cutover/sanitize-soak-db.mjs <copy>`, run from the dev box against a copy transferred to the host, or from a one-off `oven-sh/bun` container on the host. No `bun install` on the host. Add one mock provider node plus API key to the copy with `tests/parity/seed.mjs`.
- [ ] **Step 7 [OWNER OK]:** Start the soak container from `staging-<sha>` with `compose.soak.yml`. Add the Caddy site block and reload through the sibling-container method in `edge-swap-rehearsal.sh` (not `caddy reload`, which returns 403 here). This is a new site, so there is no swap of the live upstream. Confirm `curl https://<soak-host>/api/health` is 200 and `https://ai.musaddiqr.com/api/health` is unchanged.
- [ ] **Step 8:** Start the traffic trickle plus the long-stream check: a `startMock({ firstByteDelayMs: 30000 })` provider, and one streaming request through Caddy that must finish with exactly one `data: [DONE]` and no early close (Review Focus 5).
- [ ] **Step 9:** Sample for the 72 hours: every 5 minutes record RSS (`/proc/1/status`), `docker inspect` restart count and health. Daily, run `PRAGMA integrity_check`, grep the container log for `unhandled`, `Unhandled error`, `EADDRINUSE`, `SQLITE_BUSY`, and compare `usageDaily` day keys to `Asia/Jakarta`. Pass criteria: restart count 0, RSS slope ≤ 1 MiB/h by least squares (`slope` in `scripts/bench/stats.mjs`) after the first 2 hours, no 5xx not caused by the mock, `integrity_check` ok every day, health `healthy` throughout.
- [ ] **Step 10:** Mid-soak at about 36 hours, `docker stop literouter-soak` (SIGTERM, graceful), then check that the WAL is checkpointed and the DB opens in the **Node** image from `node-baseline.sh` on a throwaway copy of the soak volume (`PRAGMA integrity_check` ok, `/api/health` 200, same counts). Restart the soak container. This is the DB-compatibility proof for rollback.
- [ ] **Step 11 [OWNER OK]:** One owner-approved real-provider smoke on the soak container with one API-key provider, covering chat non-stream, chat stream, and Messages, as `promotion-gates.md` Gate 2 did. Exactly one `[DONE]` per stream.
- [ ] **Step 12:** Fill the Soak section of the evidence doc: window, RSS series summary, restart count, daily integrity results, and the Node-opens-Bun-DB result. Do not stop the soak until Task 8 begins.

### Task 8: Cutover, rollback rehearsal and cutover PR

**Files:**
- Modify: `docs/literouter-baseline/phase-bun-cutover.md` (Rollback rehearsal, Cutover)

**Interfaces:**
- Pre-conditions, all recorded in the evidence doc: Tasks 1–7 green on the same `staging` head, the main-drift check from Task 1 Step 6 empty (else re-run Tasks 2 and 4), and the soak passed.

- [ ] **Step 1:** Rollback rehearsal on a disposable copy, following `phase-rollback-rehearsal.md`. Using a throwaway volume built from a fresh `.backup` of the live DB: start the Bun image, send traffic, stop it, start the **previous Node image** on the same volume, and verify `/api/health` 200, `/v1/models` 401, the row counts, and one non-stream and one stream call. Also confirm from `scripts/deploy.sh` that its `production-<40hex>` checks accept the Node tag as a rollback target, as `tests/unit/deploy-script.test.js` covers. Record it.
- [ ] **Step 2:** Prepare the host (no builds there). Following the "Host tree and worktree reclaim" section of `pr-merge-runbook.md`: record `df -h /`, `docker ps`, and reclaim only merged worktrees.
- [ ] **Step 3:** Record the rollback anchors on the host before anything changes:
  - `OLD_TAG=$(docker container inspect literouter --format '{{.Config.Image}}')`. It must match `production-<40hex>`.
  - `docker tag "$OLD_TAG" ghcr.io/raufimusaddiq/literouter-production:rollback-node` (a second local tag. `deploy.sh` removes only `$OLD_TAG`, so the image stays). Verify `docker image ls` shows `rollback-node`.
  - `OLD_SHA=<the 40 hex from OLD_TAG>`. Keep the host tree checkout available at that SHA: the rollback uses the old `compose.production.yml`.
  - A fresh `.backup` snapshot of the live DB into `/home/ubuntu/backups/pre-bun-<date>.sqlite`, with `integrity_check` `ok`. It is the disaster copy only. Rollback does not restore it.
  - Write all four into the evidence doc.
- [ ] **Step 4:** Drift check before the PR and tree equality after the merge: `git fetch origin`. Run the Task 1 Step 6 command. Then merge any new `main` commits into `staging` and re-run what they invalidate. The cutover is a merge of `staging`, which already contains `main`, so the merge commit's tree must equal the tested `staging` head's tree. After the merge: `test "$(git rev-parse <merge-sha>^{tree})" = "$(git rev-parse <tested-staging-sha>^{tree})"`. A mismatch means `main` moved. Stop, and re-run the gates on the new tree.
- [ ] **Step 5 [OWNER OK]:** Open the `staging` → `main` PR, then enable `gh pr merge <n> --auto --merge`. This follows the rig flow: required checks `unit` and `Hermes Review`. Expect Hermes to take a long time on a diff this size. Do not push empty commits to re-trigger it (`pr-merge-runbook.md`). On reviewer feedback, respawn the worker to fix on `staging`.
- [ ] **Step 6:** After the merge, `production-image.yml` builds `ghcr.io/raufimusaddiq/literouter-production:production-<merge-sha>`. Wait for `gh run watch` to reach success. Check that this image is the Bun image: size ≤ 150 MB, and `docker run --rm <image> sh -c 'command -v node'` prints nothing. Run `bun scripts/cutover/gates/trust-gates.mjs <that image>` once more. It is the artifact that production will actually run, not the `staging-<sha>` one. If `production-image.yml` still builds `linux/amd64` only, that is correct for the production host (amd64).
- [ ] **Step 7 [OWNER OK]:** The switch, in the agreed low-traffic hour. On the host, tree at `<merge-sha>` (`git -C /home/ubuntu/9router checkout <merge-sha>`): `bash scripts/deploy.sh <merge-sha>`. `compose up -d --wait` replaces the single `literouter` container, so the old writer stops before the new one starts on `9router-data`. The script requires `healthy` and a 200 from `https://ai.musaddiqr.com/api/health` before removing the old tag. Expect a few seconds of 502, the same as the recorded Gate 10 (`promotion-gates.md`). Record the measured gap with `curl` probes at 1 s from another host.
- [ ] **Step 8:** Post-switch checks within 15 minutes: `/v1/models` 401, one authenticated non-stream and one stream request with exactly one `[DONE]`, the dashboard login works through Cloudflare, `docker stats` RSS, `PRAGMA integrity_check` ok (read-only sibling container), and the usage counters keep increasing. Re-run the T2 and T5 probes against the public hostname from outside (must stay remote). Watch the logs for an hour.
- [ ] **Step 9 [OWNER OK] Rollback, only if a trigger fires:** triggers are an unhealthy container, sustained `/v1` 5xx, any data-integrity failure, or the owner's call. Procedure: `git -C /home/ubuntu/9router checkout <OLD_SHA>` (the old `compose.production.yml`), then `bash scripts/deploy.sh <OLD_SHA>` (pulls from GHCR if the local tag was lost, otherwise uses the local image). Do not restore the backup over the volume. The DB is compatible both ways, as shown in Task 7 Step 10. Then record the reason and open a fix PR on `staging`.
- [ ] **Step 10:** After 24 hours stable, remove the soak: stop and remove `literouter-soak`, its volume and the extra Caddy block (and the DNS record), with the owner's OK. Keep `rollback-node` and the pre-Bun backup for 7 more days, then remove them with the owner's OK.
- [ ] **Step 11:** Fill the Cutover and Rollback rehearsal sections. Commit on `staging` or `main` through a normal PR: `docs: record bun cutover evidence`. Add the rows to `docs/literouter-baseline/promotion-gates.md` (parity, perf, trust model, soak, cutover).

### Task 9: Release

**Files:**
- Modify: `CHANGELOG.md`, root `package.json` `version`, the CLI package's `package.json` `version`

**Decisions.**
- Version `1.0.0` for the root app and for `literouter` (a new package name and runtime). The final `9router` release is `0.5.82` (the CLI's next version).
- Order: `literouter` first and verified, then the final `9router`, then `npm deprecate`. The old CLI self-updates with `npm i -g 9router@latest`, so the final release's startup notice reaches installed users. A deprecate warning appears only at install time, so the notice is the part that reaches them. Both are done.
- The `9router` release comes from a one-off worktree at the last Node-CLI commit, not from `main`, which no longer has that code.
- Pushing a `v*` tag runs `docker-publish.yml`, which publishes `ghcr.io/raufimusaddiq/literouter:1.0.0` for amd64 and arm64. That is a public image, so the tag is an outward action.

- [ ] **Step 1:** Edit `CHANGELOG.md`: rename the top `# v0.5.82 (unreleased)` section's contents into a `# v1.0.0` section that begins with the rewrite entry (Bun runtime, no Next.js, compiled image of N MB (the measured value), `literouter` Bun CLI, the `npm rm -g 9router` then `bun add -g literouter` migration, and "no config, DB or env changes"). Keep the older bullets below it. Bump both versions. Commit through a PR to `main`: `chore(release): v1.0.0`.
- [ ] **Step 2 [OWNER OK]:** Publish `literouter`: from the CLI package directory, `bun publish --dry-run` first and show the file list (JS bundle and SPA assets only, no `.node` files, no secrets), then `bun publish` with the owner's token or OTP entered by the owner. Verify in a clean directory: `bunx literouter@1.0.0 --version` and `bun add -g literouter@1.0.0`.
- [ ] **Step 3:** Re-run `scripts/cutover/cli-smoke.mjs` for all scenarios with `--spec literouter@1.0.0` on Windows, macOS and Linux. Record it in the CLI matrix section.
- [ ] **Step 4:** Prepare the final `9router`: `git worktree add ../9router-final <last-node-cli-sha>`. In its `cli/cli.js`, print a notice at start (`9router is now "literouter": run npm rm -g 9router, then bun add -g literouter`) and continue starting the server, so nobody's setup breaks. Set `version` to `0.5.82`. Show the owner the diff. Nothing from this worktree is committed to `main`.
- [ ] **Step 5 [OWNER OK]:** `npm publish` the final `9router@0.5.82` from that worktree's `cli/` directory (this is the one use of Node and npm). Then `npm deprecate 9router "9router moved to literouter: npm rm -g 9router && bun add -g literouter"` for all versions. Verify with `npm view 9router deprecated`.
- [ ] **Step 6 [OWNER OK]:** Tag and release: `git tag -a v1.0.0 <merge-or-release-sha> -m "LiteRouter 1.0.0: Bun runtime"`, `git push origin v1.0.0`, then `gh release create v1.0.0 --notes-file <the CHANGELOG section>`. Confirm that the `docker-publish.yml` run succeeds for both arches (this is also the first real arm64 publish).
- [ ] **Step 7:** Update the CLI package README and the root `README.md` install instructions to the `bun add -g literouter` / `bunx literouter` form. Include the migration lines.

### Task 10: Post-cutover cleanup

**Files:**
- Delete: `scripts/migrate-vitest-to-bun.mjs` and its test, `scripts/cutover/node-baseline.sh`, `tests/__baseline__/{record-test-counts.mjs,verify-test-counts.mjs,test-counts.json}`
- Modify: `.github/workflows/test.yml`, `CLAUDE.md`, `docs/literouter-baseline/pr-merge-runbook.md`, `docs/literouter-baseline/production-promotion-plan.md`, `tests/parity/` and `docs/superpowers/plans/2026-11-22-bun-rewrite-00-index.md`

Do this in one PR to `main` after the 24-hour stable check (Task 8 Step 10). Run the rig flow as usual.

- [ ] **Step 1:** Delete the codemod (`bun scripts/migrate-vitest-to-bun.mjs --check` is a CI step from Plan 1: remove that step too). Nothing imports it, so `rg migrate-vitest-to-bun` must be clean after the removal.
- [ ] **Step 2:** The test-count baseline only guarded the migration. Delete the three files above and the CI step that runs `verify-test-counts.mjs`. Keep `verify-no-regression.mjs`, `known-fails.txt` and the provider, alias and OAuth snapshots. Those still protect the registry.
- [ ] **Step 3:** The parity "record from Node" path. The recorded Node outputs become the golden corpus, so parity keeps guarding against regressions with no Node image. Commit the normalised recording from Task 2 as `tests/parity/expected/` (plus `upstream-requests.jsonl`), and have `compare.mjs` and `compare-upstream.mjs` default `<expectedDir>` to it. Delete `scripts/cutover/node-baseline.sh` and drop the "record against Node" instructions. Keep `perf-gate.mjs`, `measure.mjs` and `gates/` as the pre-release checks, and drop their Node comparison inputs only where they need a Node image (the trust gates and the image-size check run on Bun alone).
- [ ] **Step 4:** Docs. `CLAUDE.md`: remove the codemod rule and the vitest baseline notes. `pr-merge-runbook.md`: replace `vitest`, `npx vitest`, `node custom-server.js`, the `node -e` healthcheck and the "Staging is sunset" notes that are now wrong. `production-promotion-plan.md`: add a line pointing to the evidence doc. Grep `rg -n "9router|vitest|custom-server|next\b" docs README.md CLAUDE.md` and fix anything stale. Historical `phase-*.md` evidence stays as written. In the cross-plan index, apply the changes listed in the final report of this plan.
- [ ] **Step 5:** Run `cd tests && bun test --parallel`, `bunx eslint .`. Expected: green. Open the PR: `chore: remove bun-migration scaffolding`.

### Task 11: Repo declutter and a standing anti-bloat rule for the tests (owner addition, 2026-11-23)

The owner's words: "when the rewrite complete, clean up everything not needed in this repo, declutter the test, makes rule for the test not bloated and decluttered in the finishing".

Do this after Task 10, in PRs to `main`. Any deletion of a file the owner might still want, such as historical docs or scripts outside the migration scaffolding, needs the owner's OK first.

- [ ] **Step 1: Inventory.** List the rewrite leftovers the repo no longer needs, and show the owner the list before deleting anything:
  - Next-era waivers in `tests/__baseline__/` (`test-counts.json` `waived`, overrides);
  - migration-only scripts (`scripts/migrate-vitest-to-bun.mjs` and `scripts/port-next-routes.mjs`, both with their CI steps, once `main` no longer writes vitest-style tests);
  - transition-only cutover scripts (`node-baseline.sh`, `parity-images.mjs`, `refresh-goldens.mjs` once the goldens are final);
  - stale docs;
  - dead fixtures and helpers.
- [ ] **Step 2: Declutter the suite.** Merge duplicated cases and delete dead helpers and unused fixtures. **No assertion is weakened and no behaviour loses coverage.** Prove it per change: name the merged tests and show that every expectation survives. `verify-no-regression` stays green.
- [ ] **Step 3: Write the standing rule.** Add a short "Tests stay lean" rule to `CLAUDE.md`, with the reasoning in a new ADR. It covers:
  - one behaviour per test;
  - no copy-paste cases (use a table);
  - helpers only in `tests/helpers/`, deleted when unused;
  - fixtures referenced by at least one test;
  - no test that only restates the implementation.
- [ ] **Step 4: Enforce what can be enforced.** Add a CI check that fails on an unreferenced fixture or helper file, and on a test file with no assertions. Keep the check cheap and deterministic.

---

## Self-review

- **Spec coverage:** §8 bullets map as follows. Test suite and counts: Task 1. No Node anywhere: Task 0 Step 2 plus Task 8 Step 6. Differential check including cache: Task 2. Dashboard: Task 5. Trust model: Task 4. Image size and RSS: Task 3. CLI: Tasks 6 and 9. Side-by-side deploy and rollback: Tasks 7–8. §7 (`main` drift, merge procedure): Task 1. §9.6–9.8: Tasks 2, 6, 9. Release and `9router` deprecation: Task 9. Cleanup: Task 10.
- **Types:** `Measure`, `evaluatePerf`, `compareUpstream`, `sanitizeSoakDb` and `UpstreamRecord` are used with one shape each in the tasks that define and consume them.
- **Proportion:** the plan holds code only for three pure functions (`compareUpstream`, `evaluatePerf`, `sanitizeSoakDb`), and everything else is commands and checks, because those are the decisions an executor cannot make alone.
