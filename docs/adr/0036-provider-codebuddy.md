# ADR-0036: CodeBuddy provider (CN and international)

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

CodeBuddy (Tencent) is exposed as two providers, `codebuddy-cn` (copilot.tencent.com) and `codebuddy-intl` (codebuddy.ai). Both are OpenAI-compatible gateways with unusual validation: stream-only chat, a per-request channel check, a content filter and WAF that react to third-party CLI agent identities, and reasoning that is only surfaced for specific request params. The executors, registry entries and refresh logic encode what each failure looked like in practice.

## Decisions

### D1. Force stream:true; non-stream is rejected upstream

CodeBuddy answers non-stream chat with HTTP 400 code 11101 ("Non-stream chat request is currently not supported"). The same-format (openai to openai) translator path leaves `body.stream` as the client sent it, so both executors force it true. LiteRouter still re-aggregates the SSE into a JSON response for non-streaming clients.

**Where:** `open-sse/executors/codebuddy-cn.js`; `open-sse/executors/codebuddy-intl.js`

### D2. Requests must carry the official plugin's request/conversation identifiers

The gateway runs a channel check per request. Without the conversation/request ids the official plugin sends, upstream answers 400 `{"code":11128,"msg":"request illegal"}` ("This call failed channel verification, possibly because it was not sent from an official client") and the request never reaches the model; with the headers it passes and reaches the real rate limiter (429 / 6004). The headers are wired in `default.js` for both providers and declared in both registry entries. Tests lock the wiring so the ids cannot silently disappear.

**Where:** `open-sse/executors/default.js`; `open-sse/providers/registry/codebuddy-cn.js`; `open-sse/providers/registry/codebuddy-intl.js`; `tests/unit/codebuddy-channel-headers.test.js`

### D3. CLI agent identity in system prompts is neutralized

Tencent's content filter (CN) and WAF (intl) flag third-party CLI agent system prompts ("You are Claude Code, Anthropic's official CLI...", Cursor, etc.) as prompt injection or unauthorized tooling, reject the request, and on intl may ban the account. The executors detect agent system prompts and replace them with a neutral one while leaving legitimate user system prompts alone. CN uses a length catch-all plus an identity-marker regex and flattens content (string or typed blocks `[{type:"text",text}]`) before matching, preserving the original shape. Intl replaces only the lines carrying CLI-identity markers and keeps the rest of the operator prompt (project rules, output contract, safety constraints). The marker set is CLI identities only: generic template markers (`<Role>`, orchestration capabilities, "you are an agent") are legitimate operator prompts and must not be replaced.

**Where:** `open-sse/executors/codebuddy-cn.js`; `open-sse/executors/codebuddy-intl.js`

### D4. Intl requests need a leading system prompt and typed content blocks

The plain OpenAI shape is rejected by the intl gateway (11101 invalid request); it needs a leading system prompt and user content as typed blocks, not a bare string.

**Where:** `open-sse/executors/codebuddy-intl.js`

### D5. Reasoning params are opt-in and mirror the CLI

CodeBuddy surfaces model reasoning only when the request carries the CLI's OpenAI-style params: `reasoning_effort` plus `reasoning_summary:"auto"`. LiteRouter's thinking pipeline sets `reasoning_effort` only when the client asks and never sets `reasoning_summary`, so the executors add the summary when reasoning is requested. When no reasoning is requested both stay unset: forcing `reasoning_effort:"medium"` plus the summary on plain requests makes CodeBuddy's content filter trip ("model return error", #2071).

**Where:** `open-sse/executors/codebuddy-cn.js`; `open-sse/executors/codebuddy-intl.js`; `tests/unit/codebuddy-reasoning-optin.test.js`

### D6. Thinking format is forced to openai; efforts come from the published catalog

CodeBuddy is a unified OpenAI-compatible gateway, so every model (GLM, Kimi, MiniMax, DeepSeek, Hunyuan) takes reasoning via `reasoning_effort`, not its vendor-native thinking shape; the registry forces the openai thinking format. Per-model effort sets come from the server's product-config `reasoning.supportedEfforts` (see ADR-0016).

**Where:** `open-sse/providers/registry/codebuddy-cn.js`

### D7. The model catalog mirrors the server's published list

The catalog mirrors the server's product-config payload (the plugin fetches it from copilot.tencent.com). Models the server no longer publishes are removed even if the chat endpoint still answers them: the published list is the contract. Drop log: glm-5.0 / glm-4.7 and hy4-preview-x (endpoint returns 11102 "model service info not found"); glm-5.0-turbo / minimax-m2.7 / kimi-k2.5 / hy3-preview / deepseek-v3-2-volc (absent from the list though still 200); hy3-x (paid tier). deepseek-v4-flash was removed 2026-09, replaced server-side by deepseek-v4.1-flash (same low/high/xhigh efforts), in both CN and intl. A `-x` suffix means the paid tier of the same model (the free id rides the promo quota). The CN short prefix is `cbcn` (for example `cbcn/glm-5.2`); `cbai` is reserved for a future intl provider, and the full id still resolves.

**Where:** `open-sse/providers/registry/codebuddy-cn.js`; `open-sse/providers/registry/codebuddy-intl.js`

### D8. Intl mirrors the CN registry shape with its own endpoints

Intl swaps the Tencent CN domain for the .ai endpoint set. All OAuth/plugin URLs use the `/v2/plugin` prefix with `platform=ide` (CN uses `platform=CLI`).

**Where:** `open-sse/providers/registry/codebuddy-intl.js`

### D9. Quota and token refresh use their own request shapes

The quota endpoint differs from the chat gateway: a POST returns a nested Tencent billing payload (`data.Response.Data.Accounts[]`), parsed in `services/usage/codebuddy-cn.js`. CN mixes recurring refill packs with one-shot "Bonus Pack N" packs, which must surface `recurring:false` so the dashboard shows "Expires in" rather than a monthly refill; the usage handler tags it and `parseQuotaData` forwards it. Token refresh is `POST /v2/plugin/auth/token/refresh` with the refresh token in the `X-Refresh-Token` header (not a form body), matching the official CLI, and responds `{ code: 0, data: <token> }`.

**Where:** `open-sse/providers/registry/codebuddy-cn.js`; `open-sse/services/usage/codebuddy-cn.js`; `open-sse/services/tokenRefresh/providers.js`; `tests/unit/codebuddy-cn-bonus-recurring.test.js`

## Consequences

- Sending non-stream requests or dropping the plugin identifier headers returns 400 (11101 / 11128) and the call never reaches the model.
- Forwarding a CLI agent system prompt verbatim gets requests rejected and may get accounts banned.
- Forcing reasoning params on plain requests trips the content filter.
- Keeping models the server stopped publishing leaves picker entries that fail or vanish unpredictably.
- Replacing generic operator prompt markers breaks legitimate user system prompts.
