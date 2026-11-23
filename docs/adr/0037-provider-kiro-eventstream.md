# ADR-0037: Kiro provider: endpoints, auth surfaces and EventStream integrity

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Kiro (AWS CodeWhisperer / kiro.dev) is a binary-protocol upstream: its AWS EventStream responses are decoded inside `open-sse/executors/kiro.js` and emitted as OpenAI-shaped SSE, rather than going through the generic translator. It has several host surfaces, several token families (Builder ID/social, API key, external IdP, IAM Identity Center) and an "integrity gate" that decides when a turn is usable, retried or failed. Production defects here showed up as turns that answered nothing, wrong token usage and cooled-down accounts, so the rules below capture hard-won behavior.

## Decisions

### D1. Host surface order: Amazon surfaces first, regions allow-listed

Kiro deprecated the legacy path-style GenerateAssistantResponse on `runtime.*.kiro.dev` (IDE 1.0.228+ uses POST / plus `x-amz-target`). The path gateway now answers valid modern payloads with 400 REQUEST_BODY_INVALID, and 400 is terminal in `BaseExecutor`, so kiro.dev must never be the first surface for any auth method. Amazon surfaces reject foreign tokens with 401/403, which do fall through, so trying q/codewhisperer first is safe for every auth method (CLIRO parity), then codewhisperer as the fallback. Executor requests also send the SSO bearer header plus agent-mode marker; without them the deprecated gateway answers REQUEST_BODY_INVALID. Regions are interpolated into hostnames that receive the bearer token, so only a region in the per-service allowed set is ever spliced (ap-southeast-1 has no Kiro host; codewhisperer has none outside us-east-1). Rotation across baseUrls is edge-level failover, not extra 429 quota; per-account 429 spreading is account rotation in `sse/handlers/chat.js`. Retry only endpoint/auth-surface failures: a payload-invalid 400 is terminal because the same body fails on every surface.

**Where:** `open-sse/executors/kiro.js`: `getOrderedBaseUrls`, `buildUrl`, `execute`; `tests/unit/kiro-api-key-endpoint-routing.test.js`; `tests/unit/kiro-external-idp.test.js`

### D2. Auth token types map to specific headers and surfaces

API keys are stored as `accessToken`, sent as a bearer with an extra `tokentype: API_KEY` header so CodeWhisperer treats them as long-lived keys (Kiro IDE headless-auth behavior). External IdP (Enterprise / Microsoft Entra) tokens need `TokenType: EXTERNAL_IDP` to bind to profiles. IAM Identity Center (idc) tokens are AWS SSO access tokens in the same family; the kiro.dev gateway rejects them with 403 "bearer token invalid", so they must hit the `*.amazonaws.com` surface in the region the token was minted in (baseUrls are hardcoded us-east-1). The runtime gateway requires us-east-1 in the profile ARN regardless of IDC region, so auto-import normalizes the ARN region. Accounts that cannot resolve their own profileArn fall back to public default CodeWhisperer profile ARNs keyed by auth method (Builder ID and social map to different shared profiles).

**Where:** `open-sse/executors/kiro.js`: `buildHeaders`, `getOrderedBaseUrls`; `open-sse/config/kiroConstants.js`; `src/app/api/oauth/kiro/auto-import/route.js`

### D3. Repair instructions go in the user turn, never a top-level systemPrompt

kiro.dev answers any body carrying a top-level `systemPrompt` with 400 REQUEST_BODY_INVALID, so writing the tool-call repair instruction there turned every repair retry into a hard failure. The instruction goes into the current user turn.

**Where:** `open-sse/executors/kiro.js`: repair request builder; `tests/unit/kiro-terminal-integrity.test.js`; `tests/unit/system-inject.test.js`

### D4. Tool calls are validated per tool, never per turn

One unusable tool fragment used to throw out of `emitTools`, clear `state.tools` wholesale, and latch `toolValidationError`, taking every other complete tool call with it, so the client saw a turn that answered nothing. Validation is per tool; the rejected fragment is dropped and whatever is already buffered is kept. A declared tool turn that emitted no usable call is fatal only when the turn produced nothing else; throwing unconditionally escaped with provenance "invalid_tool_call", which the integrity gate re-derived into a repair retry, discarding text the client had already been promised. The "nothing usable left" check must run after `emitTools()` drops unusable tools.

**Where:** `open-sse/executors/kiro.js`: `emitTools`, frame loop, finish path; `tests/unit/kiro-usage-and-tool-integrity.test.js`

### D5. Truncation is finish_reason "length", not a hard failure

`model_context_window_exceeded` and max_tokens map to `terminal_incomplete`. When they arrive after content already streamed (chunkIndex > 0), failing the turn threw away a complete-enough answer; a truncated turn is what "length" is for. Both disposition gates need the bypass: the declared-stop-reason gate runs first and returns, so patching only `finish()` would be dead code. Only reasons that mean "usable as far as it got, then the budget ran out" qualify; `cancelled` and `pause_turn` are abandoned turns whose partial content must stay private. The reported disposition must be what the exit actually did: the integrity gate re-derives its verdict from `stop_disposition`, so reporting "terminal_incomplete" for a deliberately kept turn made it discard bytes already released.

**Where:** `open-sse/executors/kiro.js`: `stopDisposition`, finish and gate paths

### D6. Tool arguments count as output tokens

Tool argument bytes are billed output. They were never added to `totalContentLength`, so the `/4` estimator in `finish()` reported OUT 0, or the Math.max floor of 1, for every turn whose answer was a tool call (402 of 2156 Kiro usage rows had completionTokens 0). The kiro-to-claude route must also carry cache tokens (`cache_read_input_tokens`, `cache_creation_input_tokens`) so Claude clients can price turns and size prompt caches. Request translators keep a defence-in-depth check of `canonical.valid` so a future validator rule cannot ship an unusable body silently.

**Where:** `open-sse/executors/kiro.js`: tool emission and `finish`; `tests/unit/kiro-usage-and-tool-integrity.test.js`

### D7. Integrity gate can be turned off, forfeiting repair retry

`KIRO_INTEGRITY_GATE=off` streams through without gating, giving up the tool-call repair retry. Whole-response failure signatures must stay narrow: broader result/progress heuristics create false positives for completed findings. A failed attempt is classified from the AWS EventStream content type, so test mocks must return it or the failure looks like a transport error and retries forever. An unusable-conversation 400 REQUEST_BODY_INVALID cools down every account reporting it; that is a property of `ERROR_RULES` (the request-scoped `fallback: false` kind), not of this executor.

**Where:** `open-sse/executors/kiro.js`: `execute`; `tests/unit/kiro-terminal-integrity.test.js`

### D8. Synthetic model suffixes and effort fields

The `-agentic` and `-thinking` suffixes are 9router fictions that Kiro upstream does not advertise; they are stripped before the request leaves the process, and `-thinking` only injects `<thinking_mode>enabled</thinking_mode>`. The generic `model(level)` suffix is consumed first and is a request override, not part of Kiro's model id. Native effort fields vary by model: 4.6 Claude models cap at low|medium|high|max, 4.7+ add xhigh, unknown models stay conservative, and Kiro CLI has no GPT "none" wire value so it is omitted. Kiro rejected `additionalModelRequestFields` on legacy 4.5 models, while future Claude/Kiro models default to supported to avoid allowlist updates.

**Where:** `open-sse/config/kiroConstants.js`

### D9. Per-account fingerprint and frozen first message

Kiro validates per-account fingerprint headers, built from a stable credential identifier so the same account always presents the same machineId. Cacheability is preserved by freezing the first user message for a session, replaying it exactly as the first history user on later turns, and injecting volatile current-time context only into the current turn.

**Where:** `open-sse/services/kiroModels.js`; `open-sse/utils/kiroSessionReplay.js`

### D10. Gemini route streaming intent comes from the URL

For `/v1beta/models/{model}:generateContent` versus `:streamGenerateContent`, streaming is decided by the URL action suffix (the canonical Gemini convention), not a body field: `generationConfig.stream` is not a real Gemini field and Gemini CLI never sets it. The OpenAI SSE from `handleChat` is transformed to Gemini SSE on the fly.

**Where:** `src/app/api/v1beta/models/[...path]/route.js`

## Consequences

- Sending kiro.dev first, or retrying a 400, burns requests and cools down healthy accounts.
- Putting `systemPrompt` in a body breaks every repair retry.
- Per-turn tool validation brings back turns that silently answer nothing.
- Ignoring tool bytes in usage reports OUT 0/1 and breaks billing and compaction.
- Splicing an unvalidated region into a host leaks the bearer token to an attacker-controlled hostname.
