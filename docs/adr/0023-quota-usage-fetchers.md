# ADR-0023: Quota and usage fetchers

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

The dashboard's Provider Limits view and the quota auto-ping service read per-provider quota through handlers in `open-sse/services/usage/*`, which return a normalized quota object that `ProviderLimits/utils.js` (`parseQuotaData`) turns into rows for `QuotaTable`. Upstream quota APIs differ wildly (headers, protobuf, billing endpoints, session cookies) and several are rate-limited or misleading. The rules below keep the normalized shape honest so the UI does not show wrong percentages or push users into refresh loops.

## Decisions

### D1. Never forward an absolute `remaining`; supply `remainingPercentage`

`getRemainingPercentage` / `QuotaTable` interpret `remaining` as a 0-100 percentage. An absolute credit count (e.g. Qoder's 348 credits) would render as "348%", and Grok CLI, Kimi, Ollama, Vercel and the other credit/ratio providers hit the same trap. Those handlers therefore set only `remainingPercentage` (and `used`/`total` where the percentage derives from them, as for Groq headers and Codex/Kiro). Vercel needs an explicit percentage because used=95.5 / total=100 would otherwise compute 4% instead of 96%. Ollama's `usage` is a 0..1 ratio converted to a 0..100 bar. MiniMax M-series buckets only ship `*_remaining_percent`, so the count is synthesized as total=100 matching the `countMeansRemaining` semantic, otherwise the UI flips the percentage.

**Where:** `open-sse/services/usage/grok-cli.js`: `makeQuota`; `open-sse/services/usage/kimi.js`: `makeQuota`; `open-sse/services/usage/misc.js`; `open-sse/services/usage/minimax.js`; `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js`: `parseQuotaData`; `tests/unit/kimi-usage.test.js`; `tests/unit/ollama-usage.test.js`

### D2. Recurring versus one-shot quotas are distinguished and worded differently

A missing `recurring` flag defaults to true (the quota refreshes at `resetAt`). Bonus or one-shot packs set `recurring:false`, and their `resetAt` is a hard expiry, so the UI says "Expires in" instead of "Resets in". CodeBuddy CN is the main case: it mixes refill packs (a recurring allowance whose Cycle fields hold the live numbers, e.g. CycleCapacityUsed 6.54 / 500, with `CycleEndTime` far earlier than `DeductionEndTime`) and bonus packs (one-shot, `CycleEndTime == DeductionEndTime`, plain Capacity fields). They must not be merged. A gap of more than 2 days between cycle end and validity end classifies a pack as refill. Refill packs are listed first with a cadence label (Monthly/Weekly/Daily); bonus packs are "Bonus Pack N", soonest-expiring first. The handler is CN-only because a future intl variant would get its own endpoint. Quota is behind a Tencent billing POST with the payload wrapped twice under `data.Response.Data`.

**Where:** `open-sse/services/usage/codebuddy-cn.js`: `REFILL_GAP_MS` and pack classification; `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaTable.js`; `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js`: `parseQuotaData`

### D3. Claude's OAuth usage endpoint is cached, deduplicated and cooled down

The OAuth usage endpoint rate-limits with 429. Requests are deduplicated and short-TTL cached per access token (many tabs, accounts and auto-refresh all funnel through it; without this each call hits Anthropic and triggers 429). After a 429 the token is put on a per-token cooldown, which only affects the quota endpoint (chat with the same token still works). A soft failure (429 or error) prefers the last good read and is not cached. The dashboard polls Claude less often than other providers. `utilization` is percent USED (87 means 13% remaining). Model-scoped weekly limits (e.g. Fable) arrive in `limits[]` with `kind: "weekly_scoped"`, not as `seven_day_*` keys; with no entry the row is omitted, never fabricated.

**Where:** `open-sse/services/usage/claude.js`: `fetchClaudeUsageRaw`, `OAUTH_429_COOLDOWN_MS`, `USAGE_CACHE_TTL_MS`; `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js`: `CLAUDE_REFRESH_INTERVAL_MS`

### D4. Antigravity and Google quota quirks

Free-tier Antigravity accounts only have weekly quotas (no separate 5h window), and on free tier `fetchAvailableModels` returns misleading per-model quota (missing `remainingFraction` defaults to 0 or reflects the weekly limit), so tier is detected first. The project id prefers the connection-stored id, else a `loadCodeAssist` lookup, because OAuth save stores `projectId` on the connection, not in `providerSpecificData` (#1271). Weekly quota is best-effort from `retrieveUserQuotaSummary`, cached, deduplicated and never throws, so failure never breaks the per-model display. A session (5h) bucket disabled upstream because the weekly cap was hit is kept with `remainingFraction: 0` so the UI shows the 5h row; disabled weekly buckets are skipped.

**Where:** `open-sse/services/usage/google.js`: `getAntigravityUsage`; `open-sse/services/usage/antigravity-weekly.js`: `fetchAntigravityWeeklyQuota`

### D5. Kiro usage auth must mirror the chat executor

API-key Kiro connections call the quota API with a bearer token plus `tokentype: API_KEY`, so CodeWhisperer treats it as a long-lived API key; without it GetUsageLimits is rejected (401/403). For api-key auth the shared default placeholder `profileArn` is never injected because CodeWhisperer 403s a profileArn not owned by the key's account; only a profileArn resolved for the connection is sent. Social auth (Google/GitHub) tokens may not work with the quota API, so auth errors return "Chat may still work" rather than marking the account broken. The dashboard falls back to the region segment of the `profileArn` when `region` is not stored (social and imported flows).

**Where:** `open-sse/services/usage/kiro.js`: `getKiroUsage`; `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js`: `getConnectionSecondaryLabel`

### D6. Grok CLI quota: gRPC-web frame, depleted state and shared pool

The credits call needs an empty gRPC-web request frame (flag 0, length 0); without it upstream returns grpc-status 13 "Missing request message." with a 0-byte body. The frame decoder (`GetGrokCreditsConfig`) fails open and returns null on malformed input, never throwing. Exhausted free/promo accounts report cap=0/used=0/prepaid=0 and chat returns 402 `personal-team-blocked:spending-limit`; the UI treats `total===0` as unlimited, so a synthetic 1/1 depleted row is used. SuperGrok weekly shared-pool usage is one total used percent (`creditUsagePercent`); `productUsage` is a breakdown legend, never separate bars. The dashboard hides `QuotaTable` whenever `message` is set, so a message is attached only when there are no rows, letting depleted accounts keep the 0% bar.

**Where:** `open-sse/services/usage/grok-cli.js`: `GRPC_WEB_EMPTY_REQUEST_FRAME`, `parseGrokCliBilling`; `open-sse/services/usage/grokCliQuotaFrame.js`

### D7. Provider-specific auth and entitlement rules

Kimi uses dual auth: an API key sends `x-api-key` only; otherwise the OAuth access token goes as Bearer plus `X-Msh-*`. A 403 (`REASON_FEATURE_NO_PERMISSION` / permission_denied) means the account lacks the usage entitlement, not an expired session, and must not trip the usage route's `AUTH_EXPIRED_PATTERNS` force-refresh loop. GitHub Copilot usage needs the GitHub OAuth token, not the copilotToken. Zed Pro/Student report `model_requests.limit=0` for token billing, which is not a 0-cap request quota. Groq has no quota endpoint, so rate-limit info comes from `x-ratelimit-*` headers of the models list (no token cost); reset headers are Go-style durations ("2m59.56s") added to now, and a missing header must not be read as `Number(null) === 0`. Synthetic's `/openai/v1/models` is public and cannot distinguish bad keys, quotas can. Qoder PAT connections carry quota via job-token exchange; its `organization` bucket is skipped when total is 0. Vercel uses the known $5/month constant as the denominator because the API omits it.

**Where:** `open-sse/services/usage/kimi.js`; `open-sse/services/usage/github.js`: `getGitHubUsage`; `open-sse/services/usage/zed.js`; `open-sse/services/usage/groq.js`: `parseGroqDurationMs`, `buildRateLimitQuota`; `open-sse/services/usage/misc.js`; `open-sse/providers/registry/groq.js`, `open-sse/providers/registry/synthetic.js`, `open-sse/providers/registry/qoder.js`; `tests/unit/kimi-usage.test.js`

### D8. Xiaomi MiMo weekly quota needs an account session, not the sk- key

The weekly quota endpoint is authorized by an account-session cookie, not the `sk-` API key. The cookie mirrors MiMo Desktop: a `passToken` read from Desktop's Electron cookie DB (copied first, because the DB is exclusively locked while Desktop runs; return null if the copy fails) is exchanged through the passportapi SSO, authorized for `mimopc`, and stamped by `mimo-server /api/sts` into a `serviceToken` cookie. Concurrent handshakes for the same account are de-duplicated so a burst does not run the full 5-step SSO chain each time. Without a session the handler shows a clear message instead of failing.

**Where:** `open-sse/shared/mimoAccount.js`: `readDesktopAccountCookies`, `getServiceCookie`; `open-sse/services/usage/xiaomi-mimo.js`: `getXiaomiMimoUsage`

### D9. Quota auto-ping only counts accepted pings and tolerates missed windows

Codex starts its 5h window only after the streaming response completes, and its `resetAt` slides while inactive (so it polls each tick and pings when `resetAt` slides), whereas time-based windows have a stable `resetAt`. Claude waits for reset; a tick may miss its short lead window and see the next reset, so the unpinged cached deadline is caught up without marking the next cycle as pinged, and the fresh reset stays in `resetCache`. A caught-up deadline is retained on HTTP failures or thrown transport errors so the failure cooldown delays the retry. A reset is never marked pinged unless upstream accepted the tiny request. The Codex reset-credits route generates the redeem id server side to prevent client-controlled replay.

**Where:** `src/shared/services/quotaAutoPing.js`: `pingConnection`, `shouldSkipAfterFailure`; `src/app/api/usage/[connectionId]/codex-reset-credits/route.js`: `POST`

### D10. Usage accounting details

`completion_tokens_details.reasoning_tokens` is already included in `output_tokens`, so it must not be added again.

**Where:** `open-sse/translator/response/openai-to-claude.js`: usage conversion

## Consequences

- Forwarding an absolute `remaining` renders nonsense percentages ("348%") and inverts used/remaining.
- Hitting Claude's usage endpoint uncached or without cooldown triggers 429 storms and noisy quota failures.
- Treating 403 entitlement errors as expired auth causes endless re-authorize or force-refresh loops.
- Merging refill and bonus packs, or labeling bonus expiry as "Resets in", misleads users about when credit disappears.
- Missing headers read as 0 show false "0 remaining" quotas; marking unaccepted pings as pinged wastes a window.
