# Promotion gate status

PRD section 26 lists seven gates. Status below is evidence-backed as of 2026-09-19.

| # | Gate | Status | Evidence |
|---|---|---|---|
| 1 | All three ingress transports pass native and translated fixtures | PASS | `phase-transport-smoke.md`; mock upstream observed the three native paths, each 200 with no translation |
| 2 | Kenari and OpenCode Go Chat/Responses paths pass live smoke tests | BLOCKED | See below |
| 3 | Usage and Quota UI/API show no functional regression | PASS | `phase-usage-parity.md`; retained pages return 200 |
| 4 | Combo fallback, round-robin, cooldown, quota fixtures pass | PASS | 20 passing tests across the combo, quota, and account-fallback suites |
| 5 | No unbounded queue, retry loop, or synchronous per-request SQLite lookup | PASS | No unbounded retry loops in the routing path; usage buffer capped at 500 with drop-oldest |
| 6 | Startup/RSS/image/latency measurements recorded | PASS | `phase-startup-minimization.md`, `phase-latency-resource.md`, `phase-bundle-analysis.md` |
| 7 | Rollback to the prior production image is tested | PASS | `phase-rollback-rehearsal.md`; re-verified against a copy of production data: 3 providers, 40872 usage rows, health ok |

## Client endpoint compatibility

PRD section 21 requires existing clients to keep working against the same
shared endpoint. Every ingress alias a client might already be pointed at was
probed live on staging:

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

## Gate 2, blocked on a decision

The Kenari and OpenCode Go live smoke tests need real provider credentials in
staging. PRD section 25 states staging must not share production data, ports, or
credentials, so production secrets cannot be copied into staging without an
explicit decision to permit that.

What is already established about these two providers: both are live in
production and serving traffic. Kenari has 8790 recorded requests and OpenCode
Go has 6358, both with activity within the last hour. Live transport behavior
through the router is therefore proven end to end in production, though not
from the staging container.

Two ways to close the gate. First, provide staging-specific Kenari and OpenCode
Go credentials, or explicitly approve copying the production ones into
staging, then run the smoke tests. Second, accept production live traffic as
the evidence for this gate and record the deviation.

Until one of those happens, staging remains experimental and production remains
the current 9Router deployment.
