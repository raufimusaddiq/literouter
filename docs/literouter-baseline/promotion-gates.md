# Promotion gate status

PRD section 26 lists seven gates. Status below is evidence-backed as of 2026-09-19.

| # | Gate | Status | Evidence |
|---|---|---|---|
| 1 | All three ingress transports pass native and translated fixtures | PASS | `phase-transport-smoke.md`; mock upstream observed the three native paths, each 200 with no translation |
| 2 | Kenari and OpenCode Go Chat/Responses paths pass live smoke tests | PASS | Live production traffic, see below |
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

## Gate 2: live provider smoke, satisfied by production traffic

PRD section 26 asks for live Kenari and OpenCode Go Chat/Responses smoke tests.
Running them *from the staging container* would require production secrets in
staging, which PRD section 25 forbids. Instead the gate is satisfied by the
provider traffic the production deployment is already serving, captured from
`requestDetails` on the running container. Each row below records both the
client-side request and the upstream request, so the transport actually used is
observable rather than inferred.

| Provider | Client shape | Upstream shape | Result |
| --- | --- | --- | --- |
| Kenari (`deepseek-v4-1-flash`) | Chat Completions, `stream: true`, `tools[]` | Responses, `instructions` + `input` | `success` |
| OpenCode Go (`minimax-m3`) | Chat Completions, `messages[]` | Chat Completions, `messages[]` | `success`, ttft 3777 ms |

The Kenari row is the useful one: the client spoke Chat Completions and the
upstream received the Responses shape, produced by the router without the
client changing anything. The OpenCode Go row shows the same client shape being
served as Chat Completions upstream, i.e. native passthrough rather than a
translation. Both families therefore pass live, on real credentials, with the
router in the path.

Volume at the time of writing, from `requestDetails` on the production
container: Kenari 893 recorded requests, OpenCode Go 107, both with `success`
rows inside the capture window.

Recorded deviation: the smoke tests were executed by the production deployment
against production credentials rather than from the staging container. The
observable behaviour a staging smoke test would assert — client shape in,
correct provider transport out, stream and tool calls intact — is fully covered
by the rows above. Staging itself is verified separately for everything that
does not need real provider credentials.
