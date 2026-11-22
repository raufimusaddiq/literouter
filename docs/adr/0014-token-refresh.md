# ADR-0014: Token refresh and credential lifecycle

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

OAuth credentials are refreshed from several places: reactively on a 401/403 in chatCore, on demand in the usage route, and proactively by a background interval started at app init. Several providers (OpenAI/Codex, xAI/grok-cli) rotate the refresh token on every refresh, so using a consumed or stale token is not a harmless retry. It can revoke the whole token family and log the account out. Concurrency control and persistence rules therefore matter as much as the refresh call itself.

## Decisions

### D1. Always refresh from the latest stored tokens, and never continue with a dead one

OpenAI rotates the refresh token on every refresh. Refreshing from a stale in-memory snapshot is a reuse and revokes the whole session, which shows up as an account logout. `checkAndRefreshToken` and the usage route's `refreshAndUpdateCredentials` therefore re-read the connection from the DB and adopt its tokens before refreshing. When a refresh fails because the token was reused or invalidated, the family is already revoked, so the caller must stop rather than keep going with the dead token.

**Where:** `src/sse/services/tokenRefresh.js`: `checkAndRefreshToken`; `src/app/api/usage/[connectionId]/route.js`: `refreshAndUpdateCredentials`

### D2. Credentials are mutated after each successful refresh inside chatCore's retry loop

Rotating-refresh-token providers (xAI/grok-cli) issue a new refresh token on every refresh. Without updating the in-memory credentials after each success, `refreshWithRetry`'s second or third attempt reuses the already-consumed token and fails with `invalid_grant`, reported as `auth_failed` with `retryable=false`. The retried request after a refresh also supersedes the original 401/403 entirely: chatCore takes the retry's response (even an error), headers and transformed body, so failures are parsed from the retry and not from the stale auth error.

**Where:** `open-sse/handlers/chatCore.js`: `handleChatCoreInner` (refresh and retry block)

### D3. Concurrent refreshes of one credential are deduped, and only the owner persists

Lock state lives on shared global state (`refreshLocks`, via `globalThis`) because Next route bundles may each instantiate `oauthCredentialManager` separately, and a per-module map would not dedupe across them. The `onRefreshed` persistence callback runs once, inside the dedupe lock, only for the caller that owns the refresh. Waiters on the same lock receive the merged result without re-running it, so N concurrent requests make one write, not N. Results in `dedupRefresh` are keyed by the consumed (old) token, which rotating providers never send again, so expired entries are pruned on access (`pruneExpired`) to stop the map growing once per refresh.

**Where:** `open-sse/services/oauthCredentialManager.js`: `refreshLocks`, `withCredentialRefreshLock`, `refreshProviderCredentials`; `open-sse/services/tokenRefresh/dedup.js`: `dedupRefresh`, `pruneExpired`; `src/sse/services/tokenRefresh.js`: `checkAndRefreshToken`

### D4. The proactive refresher is started only from `initializeApp` and is fail-open

Proactive refresh (for example grok-cli's roughly 6h TTL) is idempotent and is started only from `initializeApp`, because `custom-server.js` cannot resolve the bare `open-sse` specifiers outside webpack. Inside it, tick errors and per-connection failures never kill the interval. It uses a dynamic import for the db layer to avoid a circular load of the db/app graph at module evaluation.

**Where:** `src/shared/services/initializeApp.js`: `initializeApp`; `src/sse/services/backgroundTokenRefresh.js`: `startBackgroundTokenRefresh`, `runBackgroundTokenRefreshTick`, `loadActiveConnections`

### D5. Background refresh is gentle on Google Cloud: sequential, with delays, and no eager projectId lookup

Accounts are refreshed one at a time with a delay between them, to avoid bursting upstream providers, especially Google Cloud. After a refresh, `onboardUser` is not triggered eagerly to resolve a projectId. Fetching projectIds for many accounts at once triggers Google Cloud anti-abuse and rate limits, so runtime handlers resolve it lazily through `getProjectIdForConnection()` on demand.

**Where:** `src/sse/services/backgroundTokenRefresh.js`: `runBackgroundTokenRefreshTick` (inter-account delay); `src/sse/services/tokenRefresh.js`: `_refreshProjectId` / `needsProjectId`

## Consequences

- Refreshing from a stale snapshot, or reusing a consumed refresh token, revokes the OpenAI session family and logs the account out.
- Not updating credentials between refresh attempts turns rotating providers into permanent `invalid_grant` failures.
- Per-bundle lock maps or an unpruned dedup cache cause duplicate refreshes and duplicate writes, or a slow memory leak.
- Starting the refresher from `custom-server.js`, or letting one failure throw out of the tick, breaks startup or silently stops all proactive refresh.
- Parallel account refresh with eager projectId resolution trips Google Cloud abuse limits.
