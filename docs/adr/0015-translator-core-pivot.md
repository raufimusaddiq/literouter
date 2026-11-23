# ADR-0015: Translator core: OpenAI pivot, registry and tool-call hygiene

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

`open-sse/translator/` converts between client formats (OpenAI Chat, Claude, Gemini, Responses, ...) and provider formats, pivoting through OpenAI Chat Completions as the intermediate shape. Many upstreams are strict about tool names, tool-call ids, parameters and JSON validity, and many clients (strict OpenAI SDKs, IDE agents) abort a turn on a malformed chunk. The decisions below record what the core must guarantee so that translation stays lossless where possible and fails loudly where it cannot be.

## Decisions

### D1. OpenAI is the pivot; exact source:target pairs are direct routes

Requests and responses pivot through OpenAI. A translator registered for an exact source:target pair (request side) or target:source pair (response side) is used instead, avoiding a lossy double hop, for example claude:kiro, and kiro:claude where `KiroExecutor` already emits OpenAI-shaped chunks that convert straight to Claude SSE. Non-streaming bodies also go provider -> OpenAI Chat Completions -> client format, so Claude and Gemini clients get their own body shape instead of a chat.completion they cannot parse. Same-format requests skip translation entirely and reach the client intact (Gemini->Gemini does not pivot).

**Where:** `open-sse/translator/index.js`: `translateRequest`, `translateResponse`; `open-sse/handlers/chatCore/nonStreamingHandler.js`

### D2. Every streamed tool call carries an id, minted once per new index

OpenAI streaming puts id and function.name on the first fragment of a tool call; later fragments carry only `index` plus argument deltas. Some providers open a new index late and omit the id, which makes strict clients (`@ai-sdk/openai-compatible`: "Expected 'id' to be a string") abort the whole turn (#4992). The stream remembers which indexes the client has seen and mints an id only when a fragment opens an unseen index. Continuation fragments of a known index stay id-less, because accumulators concatenate string deltas and a repeated id would become `call_abccall_abc`. This applies to same-format passthrough and to the intermediate OpenAI shape before any translator sees it; Anthropic tool_use requires an id and openai-to-claude previously dropped such calls with their arguments. The passthrough path also has no translation to carry the fingerprint's tool rename map (read -> read_client), so it must be handed over explicitly or clients receive calls to tools they never declared (#4986).

**Where:** `open-sse/utils/streamHelpers.js`: tool-call id helper; `open-sse/utils/stream.js`; `open-sse/translator/index.js`: `translateResponse`; `open-sse/handlers/chatCore/streamingHandler.js`; `tests/unit/stream-tool-call-id.test.js`

### D3. Unsupported features are rejected, not silently degraded

When a request is translated to a non-OpenAI target, `n>1` and `logprobs` with `top_logprobs` return a 400 (`RequestParamError`), since the response translator keeps only choice 0. Plain `logprobs: true` or `top_logprobs: 0` is ignored because IDE agents send it routinely. Source-format equivalents (Gemini `generationConfig`, including inside the Cloud Code `request` envelope) are checked too, and the guard runs before the source->OpenAI hop, where `candidateCount` would otherwise become `n` and be dropped silently. Same-format requests are not rejected.

**Where:** `open-sse/translator/concerns/requestParams.js`; `open-sse/translator/index.js`: `translateRequest`

### D4. Provider-rejected parameters are stripped or rewritten in a config table

Upstreams return 400 for parameters they dislike, so `paramSupport.js` rules drop or rename them. Claude models: `temperature` is deprecated and rejected (#1748). GitHub Copilot gpt-5.4: `temperature` unsupported. Copilot Claude except opus/sonnet 4.6: `thinking` and `reasoning_effort` rejected (#713). Current OpenAI gpt-5.x/6.x reject `max_tokens` ("Use 'max_completion_tokens' instead"), so it is renamed. OpenCode Go's relay rejects `response_format` (json_schema and json_object) for its deepseek family with unclassifiable 400s (a bare model echo, or "This response_format type is unavailable now"; measured 2026-10-13: 12/12 structured calls 400, 4/4 without the field 200), so it is stripped for that family only. VolcEngine Ark caps the Kimi family at `max_tokens <= 32768` while the model's advertised ceiling is far higher (Kimi-K2.7-Code resolves to 262144), so an explicit endpoint cap is pinned and combined by min() with the model ceiling. Rules stay config-driven.

**Where:** `open-sse/translator/concerns/paramSupport.js`: `STRIP_RULES` and related rule tables

### D5. Providers that reject content-part arrays get plain-string content

Cloudflare Workers AI (oneOf root schema, #1926) and MiMo Desktop Preview models (account-service route) accept `content` only as a plain string and reject the OpenAI content-part array, so content is flattened. MiMo cloud models keep their parts because mimo-v2-omni is multimodal.

**Where:** `open-sse/translator/concerns/paramSupport.js`

### D6. Tool names are rewritten to the upstream-valid pattern

Codex (Responses) and Anthropic require tool names matching `^[a-zA-Z0-9_-]{1,128}$`. MCP-style names such as `server.tool` are rewritten for the upstream and mapped back on the response. Names that are already valid are reserved first so an alias can never collide with a real tool. Separately, tool normalization before dispatch dedups MCP-equivalent built-ins for Claude clients, and for DeepSeek models drops exact same-name duplicates (first wins) because DeepSeek rejects them with 400 "Tool names must be unique" on every endpoint (verified live 2026-08-15; GLM/MiniMax/Kimi accept duplicates). Dedup can strip a tool that history `tool_reference` blocks still name; strict Claude-compatible upstreams then reject the request (z.ai 400 code 1210, verified 2026-11-08), so such references are removed, and if nothing remains a text note is left because an empty content array is itself invalid.

**Where:** `open-sse/translator/concerns/toolNames.js`; `open-sse/utils/toolDeduper.js`

### D7. Missing tool responses are filled in

OpenAI requires every tool_call to have a response. The Claude-to-OpenAI request translator scans contiguous tool replies and inserts "[No response received]" where one is missing, as a local variant distinct from the global immediate-next check in `concerns/toolCall`, which runs on the OpenAI leg. Fallback Responses call ids use a per-process sequence, since a batch sanitized in a tight loop shares one `Date.now()` and function_call/function_call_output correlation must not collide.

**Where:** `open-sse/translator/request/claude-to-openai.js`; `open-sse/translator/formats/responsesApi.js`

### D8. Thinking intent and session id are captured from the original body

Thinking intent is captured from the pre-translation body, before conversion strips or renames fields, and applied after translation. The client session id is captured while the envelope is intact (for example antigravity `request.sessionId`) and exposed as `credentials._clientSessionId` to downstream translators (gemini-cli/antigravity envelopes) that run after the envelope is stripped. Trailing assistant prefill is detected per source shape (`messages[]`, `contents[]`, `input[]`): only an explicit trailing model/assistant turn counts as ASSISTANT for `ensureTrailingUserTurn`, so other tails (for example a function output) keep the emptied-turn fix.

**Where:** `open-sse/translator/index.js`: `translateRequest`, `detectClientLastRole`

### D9. Model id normalization is narrow

Registry ids use dots for versions (`claude-sonnet-4.5`) but clients send dashes. For DOT_VERSION_PROVIDERS (kiro) only, `findModel` rewrites a hyphen between two digits to a dot, leaving word and suffix hyphens intact (`-thinking`, `-agentic`, `qwen3-coder-next`). Other providers use exact match. A trailing thinking suffix `(level)` is split off for lookup and re-appended so downstream `applyThinking` still sees it. Claude Code's `[1m]` context marker (`claude-opus-5[1m]`) is a client annotation matching no combo, alias or provider/model pair, so it is stripped before model resolution; the real capability travels in the forwarded `anthropic-beta: context-1m-2025-08-07` header.

**Where:** `open-sse/config/providerModels.js`: `DOT_VERSION_PROVIDERS`, `findModel`; `open-sse/providers/models/schema.js`; `open-sse/utils/modelMarkers.js`

### D10. max_tokens ceiling is model-aware and stays above the thinking budget

`adjustMaxTokens` takes a ceiling so high-output models (Opus 4.8 = 128000) are not pre-clamped to the conservative 64000 default before the model-aware step; openai-to-claude passes the model's real maxOutput. The Claude API requires `max_tokens` strictly greater than `thinking.budget_tokens`, so a buffer is added rather than using a ceiling that could equal the budget.

**Where:** `open-sse/translator/formats/maxTokens.js`: `adjustMaxTokens`; `open-sse/translator/request/openai-to-claude.js`

### D11. Non-stream shapes are shared and spec-valid; refusals are not stops

Non-streaming client-shape converters (Responses `output`, Gemini candidates) are shared by the JSON handler and the forced-stream (SSE->JSON) handler so the two cannot drift. Responses `status` must be completed|incomplete|failed; provider stop reasons must not leak into it. A refusal is a blocked turn: mapped to the default stop, OpenAI clients saw an empty message with finish_reason "stop" and could not tell it from a real answer, so it maps to a distinct reason.

**Where:** `open-sse/translator/concerns/nonstreamShapes.js`; `open-sse/translator/concerns/finishReason.js`

### D12. Registry init, format detection and payload hygiene

The translator registry is declared with `var` and lazily initialized so `register()` side-effect calls during circular imports do not hit a TDZ error; translator modules self-register via static side-effect imports. Format detection tests OpenAI-specific fields before Claude structure because they never appear in Claude requests, and a `/v1/chat/completions` body with `input[]` is treated as OpenAI (Cursor CLI sends a Responses body to that endpoint). An empty `tools` array is removed because some providers (Qwen) reject it. Outgoing JSON replaces lone UTF-16 surrogates (a split emoji) with U+FFFD, since strict parsers reject the bare escape (kenari 400). Ollama NDJSON is gated on the explicit format argument. The OpenAI tool role is text-only, so a tool_result image is re-attached as an image_url block on the following user turn, tagged with the originating tool_use_id, and the continuity blob stashed for round-trip symmetry is removed at the outbound boundary before any upstream.

**Where:** `open-sse/translator/index.js`; `open-sse/translator/formats.js`; `open-sse/services/provider.js`: `detectFormat`; `open-sse/translator/formats/openai.js`: `filterToOpenAIFormat`; `open-sse/utils/wellFormedJson.js`

## Consequences

- Dropping the id mint, or repeating ids on continuation fragments, aborts strict clients or corrupts the id and breaks tool results.
- Silently degrading `n>1` or logprobs, or leaving stripped params in, produces upstream 400s or wrong answers instead of a clear error.
- Removing direct routes forces lossy double-hops for fragile pairs (kiro thinking blocks, tool ids).
- Broad dash-to-dot rewriting would corrupt ids for providers whose real ids contain digit hyphens.
- Clamping max_tokens to 64000, or letting it equal the thinking budget, truncates high-output models or triggers Claude 400s.
