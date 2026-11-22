# ADR-0045: Antigravity quota routing and strike circuit breaker

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Antigravity accounts are selected partly from a cached quota snapshot that the auth pre-filter reads to skip exhausted account/model pairs. Google's quota API can report remaining quota while the generation endpoints keep returning 429 (a sprint/weekly dual-pool mismatch, #3681), and Antigravity also signals pool exhaustion with 409 (#3561). Left alone this causes retry storms against upstream. The quota cache in `src/sse/services/antigravityQuota.js` and the chat handler's fallback loop cooperate to avoid that.

## Decisions

### D1. A strike-based circuit breaker overrides optimistic quota readings

After `STRIKE_THRESHOLD` (3) 429/409 responses within `STRIKE_WINDOW_MS` (60 s) for the same connection+model, the optimistic quota reading is treated as untrusted and the pair is cache-blocked for `STRIKE_BLOCK_MS` (15 min). A strike counts whenever the quota reading is optimistic (remaining > 0) or unavailable (quota API 403/error). 409 counts by design, since Antigravity signals pool exhaustion with 409 as well; poisoning by transient 409s needs 3 inside 60 s on the same pair. The window is fixed and anchored at the FIRST qualifying strike: three 429s must land within 60 s of that first one, not within 60 s of each other.

**Where:** `src/sse/services/antigravityQuota.js`: `handleAntigravityQuotaError`, `STRIKE_*` constants; `tests/unit/antigravity-quota-routing.test.js`

### D2. A tripped breaker is visible to the auth pre-filter and survives refreshes

The breaker synthesizes a 0% entry in the shared quota cache so the auth pre-filter skips the pair on later requests, not just the current retry loop. The chat handler does not persist a `modelLock_*` for this path; an exhausted Antigravity model is blocked only in the RAM cache until upstream `resetAt`. Active strike blocks are re-applied onto every fresh quotas snapshot, so an optimistic upstream reading cannot resurrect a pair that was just circuit-broken. An optimistic reading, by contrast, must NOT poison the shared cache (the pre-filter treats cached 0% as exhausted).

**Where:** `src/sse/services/antigravityQuota.js`: `applyActiveStrikeBlocks`, `_doRefresh`; `src/sse/handlers/chat.js`: fallback loop; `tests/unit/antigravity-quota-routing.test.js`

### D3. Strikes are consecutive: a success clears them

A successful request clears strike state for that connection|model so "consecutive" means consecutive. Only a synthesized cache entry (`resetAt` equal to our block deadline) is removed; a real upstream 0% reading stays.

**Where:** `src/sse/services/antigravityQuota.js`: `clearAntigravityStrikes`; `src/sse/handlers/chat.js`: success path

### D4. Quota refreshes are coalesced, throttled and failure-tolerant

Concurrent refreshes are coalesced (`inflight`) before applying the interval gate, and every attempt is recorded so failed quota calls cannot amplify an upstream 429 burst. The throttle applies to error paths too: one quota request per account per 30 s; the first 409/429 populates the cache and later errors reuse it. 401/403 usage responses can carry an empty quotas object plus a message, so the known cache is preserved instead of being replaced by an upstream error response. The quota cache is lazy: it is only populated after that account returns 409/429.

**Where:** `src/sse/services/antigravityQuota.js`: `refreshAntigravityQuota`, `MIN_REFRESH_INTERVAL_MS`; `src/sse/services/auth.js`: `getProviderCredentials`

## Consequences

- Trusting the quota API alone yields retry storms against accounts that keep 429ing.
- Persisting a `modelLock_*` for this path, or letting refreshes drop strike blocks, either over-blocks across restarts or un-blocks pairs prematurely.
- Not clearing strikes on success makes "3 strikes" accumulate over unrelated failures.
- Replacing a good cache with a 401/403 error response, or refreshing unthrottled, amplifies upstream 429 bursts.
