# ADR-0009: Account selection, rotation and fallback

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Each provider can have many connections (accounts or API keys). When an upstream call fails, the gateway decides whether to lock the account, rotate to another account, let a combo move to another model, or hand the error back. That decision rests on a classification of the failure ("scope") in `open-sse/config/errorConfig.js`, applied by `open-sse/services/accountFallback.js`, `src/sse/services/auth.js` and `src/sse/handlers/chat.js`. Getting the scope wrong either locks healthy accounts, or bills the same generation twice, or hides the real error from the caller.

## Decisions

### D1. Failures have a scope that decides who may react

`SCOPE` has three values. `request`: the request itself is bad, so no account fallback, no lock and no combo fallback. `model`: this model cannot serve it (for example context overflow), so no account fallback and no lock, but a combo may try another model. `account` (default): the credential or provider is unhealthy, so lock plus account and combo fallback. `context_length_exceeded` is model-scoped because the account is healthy and rotating or locking would not help; `content_policy_violation` and Kiro's "improperly formed request" 400 are request-scoped because no model or account will accept them. `ERROR_RULES` are checked top-to-bottom, text rules before status rules, so rule order encodes priority. NVIDIA NIM returns 400 with "degraded" when a model cluster is unhealthy; its 15 minute cooldown lands on the model lock, not the whole API key, so provider-scoped rules must also match on the combo path (the seat's provider id is passed in and the backoff level is 0 there). A 408 (upstream could not read our body in time) is a transient transport fault: a short cooldown, then another account.

**Where:** `open-sse/config/errorConfig.js`: `SCOPE`, `ERROR_RULES`; `open-sse/services/accountFallback.js`: `checkFallbackError`; `open-sse/services/combo.js`

### D2. Unmatched 4xx errors are handed back, not cooled down

A 400 caused by the request (context overflow, malformed body, unsupported parameter) says nothing about the credential. Locking the account only removes a healthy connection from rotation, and with a single connection every later request in the window fails with a copy of the first error ("all 1 accounts locked for <model> | lastError=[400]: ..."), which hides the real cause and makes unrelated sessions look like they hit the same limit. Unmatched 4xx therefore returns the upstream error for that request only. Account-scoped statuses (401, 402, 403, 404, 429) keep their rules, and the text rules for rate-limit, quota and capacity wording still win. Request-scoped failures stop everywhere; model-scoped ones only let a combo move on. In `auth.js` request- or model-scoped failures write no lock and no health state, and the caller must not rotate accounts for them. If the connection vanished mid-flight there is nothing to lock, but rotation to another account still happens.

**Where:** `open-sse/services/accountFallback.js`: `checkFallbackError`; `src/sse/services/auth.js`: `markAccountUnavailable` failure path (`shouldRotateAccount`); `tests/unit/account-fallback-4xx.test.js`

### D3. Client aborts and gateway timeouts never lock or rotate

A client abort (499) or gateway timeout (504) says nothing about the account. It is never locked and never falls through to another account, because that would bill the same generation again. Account fallback attempts are also bounded explicitly (`MAX_ACCOUNT_FALLBACK_ATTEMPTS`, PRD 24): `excludeConnectionIds` already prevents repeats, but quota refresh paths can re-evaluate providers, so the cap keeps retry behavior finite and deterministic.

**Where:** `src/sse/handlers/chat.js`: account-selection loop (`maxAccountAttempts`, abort/504 branch)

### D4. Provider-reported cooldowns are capped but not truncated per model

`MAX_RATE_LIMIT_COOLDOWN_MS` (30 minutes) hard-caps provider-reported rate limit cooldowns, because values such as Codex `resets_at` can be 5 to 6 hours. GitHub premium-request exhaustion is account-wide until the next UTC month. Antigravity's quota API gives an exact per-model `resetAt`, which must not be truncated. The backoff level is read inside the write transaction so concurrent failures cannot compute the same level; the earlier lookup is read-only (display name only).

**Where:** `open-sse/config/errorConfig.js`: `MAX_RATE_LIMIT_COOLDOWN_MS`; `src/sse/services/auth.js`: lock computation (`githubMonthlyResetMs`, antigravity branch)

### D5. Round-robin cursor is runtime-only state

Account rotation is request-serving state, not durable provider configuration. Persisting it on every request caused a SQLite UPDATE, connection-cache invalidation and a Redis version bump for each successful selection. The cursor lives in a process-global map. The selection and update block runs synchronously in JavaScript, so no async mutex is needed within one process.

**Where:** `src/sse/services/auth.js`: `selectionState`, `pickRoundRobinConnection`

### D6. Connection priorities: no reorder on insert, API keys never silently overwritten

A new connection gets `MAX(priority)+1`, computed in SQL (served by the index) so the apikey path does not load the whole pool. That already sorts last, so inserts skip `reorderInTx`; the rewrite cost about 2N statements per insert and made a 5k-key import O(n*m) (about 25M statements) and serialized parallel writers (#4311). `reorderInTx` stays for deletes and explicit reorders, normalizing to a contiguous 1..N, and must be called inside a transaction. API-key connections are deduped by name with a direct query; OAuth connections still scan because identity rules compare fields inside `providerSpecificData`. A name collision used to silently replace the stored apiKey, so a script reusing "Key 1", "Key 2" destroyed pool entries without a 409; now callers that mean "update" pass `allowOverwrite`, and others get a typed error naming the row.

**Where:** `src/lib/db/repos/connectionsRepo.js`: `reorderInTx`, `createProviderConnection`

### D7. Model resolution keeps routing identities unambiguous

A combo name is checked before alias resolution so combo names never get routed to providers by mistake. Provider-node prefixes are user-defined and must not override reserved built-in provider ids and aliases such as `cf`, `cloudflare-ai`, `openai` or `hf` (`RESERVED_PROVIDER_PREFIXES`). The bare virtual model `codex-auto-review` sent by Codex CLI stays on OAuth Codex (#1398). A bare `claude-*` id infers provider "anthropic" (API key); when no anthropic connection is active but a Claude OAuth one is, it falls back to "claude" instead of failing with "No active credentials for provider: anthropic". Claude Code's `<model>[1m]` marker matches no combo, alias or provider/model pair, so it is stripped before resolution while the capability travels in the `anthropic-beta` header.

**Where:** `src/sse/services/model.js`: `RESERVED_PROVIDER_PREFIXES`, `fallbackToClaudeOAuth`, combo lookup; `open-sse/services/model.js`; `src/sse/handlers/chat.js`: `stripModelContextMarker`

### D8. Chat handler glue: error shape, abort signal, adapter models

All error paths in `chat.js` build OpenAI-shaped bodies and are re-shaped once at the top so `/v1/messages` clients get Anthropic errors and `/v1beta` clients get Gemini errors. Routes that rebuild the Request must pass `signal` through so `chatCore` sees client aborts. A single-model request may still switch to a capacity-adapter model when the target lacks a capability the request needs (for example vision for an image). `src/sse/handlers/chat.js` installs proxy-aware fetch by importing only `open-sse/utils/proxyFetch.js` rather than the whole open-sse barrel and executor graph.

**Where:** `src/sse/handlers/chat.js`: `handleChat`

## Consequences

- Misclassifying a request-scoped 400 as account-scoped locks healthy connections and, with one connection, masks the real error across unrelated sessions.
- Rotating on aborts or 504s bills the same generation on multiple accounts.
- Uncapped provider cooldowns can lock an account for hours; truncating Antigravity resets loses exact per-model recovery times.
- Persisting the rotation cursor per request reintroduces a write, cache invalidation and version bump on the hot path.
- Reordering on every insert makes bulk key imports quadratic and serializes parallel writers; allowing silent overwrite on name collision destroys pool entries.
- Letting user-defined provider-node prefixes shadow built-ins misroutes traffic.
