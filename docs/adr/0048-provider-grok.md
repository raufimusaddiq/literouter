# ADR-0048: Grok CLI / Grok Build provider

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

The `grok-cli` provider talks to `cli-chat-proxy.grok.com` using the OpenAI Responses API, impersonating the official `@xai-official/grok` CLI. It is distinct from `xai` (api.x.ai, API key or OAuth PKCE) and `grok-web` (grok.com web SSO cookie). Its wire behaviour comes from a HAR/wire capture of the official client, so the executor mirrors that client closely.

## Decisions

### D1. Keep the client identity on a current official release

The proxy rejects older identities with HTTP 426. `GROK_CLI_VERSION` is pinned to a current `@xai-official/grok` release (1.0.44 as of 2026-10-01; the minimum accepted is 1.0.13) and must be bumped when the proxy raises its floor. The registry's source of truth is the wire capture of that client.

**Where:** `open-sse/config/grokCli.js`: `GROK_CLI_VERSION`; `open-sse/providers/registry/grok-cli.js`

### D2. System role is kept as "system", not converted to "developer"

The official grok-pager HAR sends `role:"system"`; Codex converts system to developer, Grok CLI does not. The executor leaves system messages untouched and a test locks it.

**Where:** `open-sse/executors/grok-cli.js`: request transform; `tests/unit/grok-cli-executor.test.js`

### D3. Reasoning effort priority and exceptions

Priority is explicit value, then `reasoning_effort`, then model suffix, then default `high`. grok-build and Composer reject `reasoningEffort` but still accept summary and encrypted continuity, so effort is omitted for them.

**Where:** `open-sse/executors/grok-cli.js`: reasoning effort resolution

### D4. Per-request ids travel with the transformed body

The executor is a singleton and must not hold request state, so per-request ids ride on the transformed body rather than on the instance.

**Where:** `open-sse/executors/grok-cli.js`

### D5. Connection test: 402 spending-limit is a soft success

The test probes `/v1/user` (no inference quota) with headers mirroring the official CLI. A subscription spending-limit 402 is not an auth failure: the token is fine and the credits are not, so 402 is accepted and the connection stays "active" with a warning (same idea as Codex's 400). Soft success applies only when the provider configured an explicit message for that status; Codex-style `acceptStatuses:[400]` stays silent because 400 there only proves auth. The message is surfaced as `lastError` without marking the connection broken. The Cloudflare bypass on validation sends the POST with the same browser fingerprint headers as `GrokWebExecutor`.

**Where:** `src/app/api/providers/[id]/test/testUtils.js`; `src/app/api/providers/validate/route.js`; `tests/unit/grok-cli-oauth-probe.test.js`

### D6. Quota tracking mirrors the official CLI and keeps the exhausted bar visible

The official CLI polls `billing?format=credits` and `user?include=subscription`, and the quota request needs an empty gRPC-web frame (flag 0, length 0). The HAR OAuth scope includes conversations read/write beyond xAI's api-only scope. The dashboard hides the QuotaTable when `message` is set, so the usage result keeps `message` empty so the 0% bar still renders for exhausted free/promo accounts.

**Where:** `open-sse/providers/registry/grok-cli.js`; `tests/unit/grok-cli-usage.test.js`

## Consequences

- A stale client version gets 426 from the proxy and the provider stops working.
- Converting system to developer, or sending effort to grok-build/Composer, diverges from the official client and may be rejected.
- Treating 402 as failure marks healthy credentials as broken; setting `message` on exhausted accounts hides their quota bar.
- Storing request ids on the executor singleton leaks state across concurrent requests.
