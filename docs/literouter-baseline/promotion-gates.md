# Promotion gate status

PRD section 26 lists seven gates. Status below is evidence-backed as of
2026-09-19. Staging references are historical; current validation uses CI,
production smoke, and disposable-copy rehearsals.

| # | Gate | Status | Evidence |
|---|---|---|---|
| 1 | All three ingress transports pass native and translated fixtures | PASS | `phase-transport-smoke.md`; mock upstream observed the three native paths, each 200 with no translation |
| 2 | Kenari and OpenCode Go Chat/Responses paths pass live smoke tests | PASS | Recorded provider smoke tests; staging run is historical |
| 3 | Usage and Quota UI/API show no functional regression | PASS | `phase-usage-parity.md`; retained pages return 200 |
| 4 | Combo fallback, round-robin, cooldown, quota fixtures pass | PASS | 20 passing tests across the combo, quota, and account-fallback suites |
| 5 | No unbounded queue, retry loop, or synchronous per-request SQLite lookup | PASS | No unbounded retry loops in the routing path; usage buffer capped at 500 with drop-oldest |
| 6 | Startup/RSS/image/latency measurements recorded | PASS | `phase-startup-minimization.md`, `phase-latency-resource.md`, `phase-bundle-analysis.md` |
| 7 | Rollback to the prior production image is tested | PASS | `phase-rollback-rehearsal.md`; the prior image boots from a copy of `9router-data` with no schema error, reads 3 providers, serves `/api/health` 200, and reads the usage history |
| 8 | Single-writer cutover rehearsal | PASS | `phase-edge-swap-rehearsal.md`; on a disposable copy of `9router-data`: old writer stopped, successor booted from the same volume, real `kn/deepseek-v4-1-flash` call returned 200, stream closed with exactly one `[DONE]`, rollback to the old image re-served health, and the successor's write-back extended the source counters (50289 → 50484 `usageHistory`) |
| 9 | Production cutover, zero data loss | PASS | `phase-edge-swap-rehearsal.md`; one writer at a time, backup verified before the swap, volume `integrity_check` `ok` after, retained counts carried over (50689 → 50717 `usageHistory`) |
| 10 | Production cutover, zero downtime | FAIL | same run: the public edge returned `502` for ~3 s between stopping the old writer and the successor accepting traffic. Closing it requires a durable store that is not a single SQLite file |

Row counts differ between the phase documents (39733, 39742, 39903, 40154,
40872, 40956 `usageHistory`) because each was captured at a different moment
against a live volume. Only the capture id in `README.md` is authoritative; a
count quoted in a phase document is evidence for that document's check, not a
current total.

## Bun runtime cutover (2026-11-23)

These are the gates for switching production from the Node/Next image to the Bun image (spec
`docs/superpowers/specs/2026-11-22-bun-rewrite-design.md` §8). The full evidence is in
`phase-bun-cutover.md`.

| # | Gate | Status | Evidence |
|---|---|---|---|
| B1 | Differential parity with `main`'s Node image | PASS | 407 fixtures and 125/125 routes. Upstream request bodies are byte-identical, including the prompt-cache cases. The differences found (JSON `content-type` charset, Node's default upstream fetch headers, the 404 title) were fixed. Header allowlist `[]` |
| B2 | Performance: RSS, latency, image size | PASS | Idle RSS 115.8 → 57.4 MiB; post-burst 123.0 → 89.6 MiB; p50 7.6 → 3.5 ms; p95 20.2 → 11.2 ms. Image 116.3 MB (amd64) and 117.8 MB (arm64), both ≤ 150 MB |
| B3 | Trust model behind a production-shaped Caddy, plus SSRF | PASS | 13/13 on the staging image and on `production-e428843d`. Mutants with the proxy-marker or SSRF check disabled turn their cases red |
| B4 | Soak | SKIPPED | Skipped by the owner's decision. The DB-compatibility proof moved into B5 |
| B5 | Rollback rehearsal on a copy of the live DB | PASS | Bun, then the Node image `production-a6c24a6d`, ran on the same sanitized snapshot: `integrity_check` ok, identical row counts, stream and non-stream traffic through both |
| B6 | Production cutover | PASS | `deploy.sh e428843d…` after checking out the host tree. One failed probe at 1 s intervals. Post-switch checks all pass, and real traffic is served on `bun:sqlite` with Redis connected. No rollback |

## Client endpoint compatibility

PRD section 21 requires existing clients to keep working against the same
shared endpoint. Every ingress alias a client might already be pointed at was
probed in the retired staging capture:

```text
POST /v1/chat/completions  200
POST /v1/responses         200
POST /v1/messages          200
POST /api/v1/messages      200
POST /responses            200
POST /codex/responses      200
GET  /v1/models            200
GET  /v1beta/models        200
```

No client needs an endpoint change.

## Gate 2: live provider smoke (historical staging capture)

PRD section 26 asks for live Kenari and OpenCode Go Chat/Responses smoke tests.
These were run from the retired staging container against the real providers.

Credential handling: production API keys were imported into the retired staging
database, because both are first-class registry providers
(`open-sse/providers/registry/kenari.js`, `opencode-go.js`) that need only an
`apiKey` connection and have no separate staging account. Only the key and the
proxy settings were copied. The production `modelLock_*`, `backoffLevel`,
`lastError`, and `rateLimitedUntil` fields were deliberately **not** copied, so
staging starts with clean health state and the lock data production accumulated
cannot mask a routing bug here. Staging keeps its own SQLite volume, port, and
network; no production data was shared.

Recorded deviation from PRD section 25: the smoke tests use production provider
credentials. PRD section 25 forbids staging sharing production credentials, and
this is the sole place that rule is relaxed. The relaxation is documented here
rather than silently applied. It is bounded to an outbound API key on a
provider whose other production state (locks, backoff, rate limits) was
deliberately excluded.

| Provider | Transport | Result |
| --- | --- | --- |
| Kenari (`deepseek-v4-1-flash`) | Chat Completions | 200, native chat shape |
| Kenari | Responses (`input`) | 200, native Responses shape |
| Kenari | Messages | 200, native Claude shape |
| OpenCode Go (`minimax-m3`) | Chat Completions | 200 |
| OpenCode Go | Responses (`input`) | 200 |

All five ran through the retired staging router on `/v1/*` with a staging API key, so
the router was in the path for every call.

Streaming was checked separately, since a duplicated or missing sentinel is the
failure mode that a non-streaming smoke test cannot see:

| Provider | Stream lines | `data: [DONE]` count | Content deltas |
| --- | --- | --- | --- |
| Kenari | 22 | 1 | 8 |
| OpenCode Go | 12 | 1 | 3 |

Exactly one sentinel each, with content intact. Tool calls were exercised on
Kenari Chat Completions and returned `finish_reason: "tool_calls"` with a
well-formed `tool_calls[]` entry carrying the parsed arguments.

## Deviation: Console Log retained (PRD section 18)

PRD section 18 lists the Console Log page as a removal candidate, qualified by
"if all required diagnostics remain available through retained Usage/details".
The condition does not hold, so the page is retained.

`src/lib/consoleLogBuffer.js` patches the global `console` methods and keeps a
rolling in-memory buffer of server-side output. The retained Usage and
request-detail views read `usageHistory` / `requestDetails` — request records,
not console output. On a Docker deployment there is no other in-browser way to
read server logs, so removing the page would have removed the only such view.

The removal attempt also exposed a path-coupling bug: the page's API lived at
`/api/translator/console-logs`, under the `/api/translator` prefix hidden for
the translator playground. Hiding an unrelated feature took the log stream down
with it. The API now lives at `/api/console-logs` so the two features no longer
share a prefix, and the boundary test asserts that no hidden prefix shadows it.
