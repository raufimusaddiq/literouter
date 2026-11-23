# ADR-0011: chatCore pipeline and non-streaming handling

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

`open-sse/handlers/chatCore.js` detects the client format, translates the request, picks an upstream transport, dispatches to an executor and shapes the response. Around it sit `BaseExecutor`/`DefaultExecutor` (retry, timeout, headers), the non-streaming and SSE-to-JSON handlers, and the provider helpers in `open-sse/services/provider.js`. Most of the decisions below exist because some upstream rejects a body or URL that looks locally correct. The reasons are easy to lose, and the code looks simplifiable without them.

## Decisions

### D1. The endpoint must follow the translated body's wire format, chosen per model

For multi-endpoint providers, chatCore picks the transport that matches the client's source format, which means zero translation. It does this only when the model either declares no `supportedFormats` (the provider default is kept, for example glm/deepseek) or declares the source format among them. opencode-go models differ in endpoint support: kimi and glm only serve `/chat/completions`, so without the guard a claude-format request would route kimi to `/messages`. When the client's format is not among the model's `supportedFormats`, chatCore falls back to the transport for the model's declared `targetFormat`, so the URL always matches the translated body. A Responses-only model (Muse Spark, `supportedFormats: ["openai-responses"]`; OpenCode Go Luna) requested by an OpenAI client was otherwise translated to a Responses body (`input`) and POSTed to the Chat Completions URL, which upstream rejects with "unknown parameter `input`". A source-format-matched endpoint is preferred over a model-level `targetFormat`, which is only the fallback for clients whose wire format has no supported transport. For example, OpenAI clients stay on `/chat/completions` for MiniMax-M3, while other clients fall back to its declared Claude target (regression: decolua/9router #3418, PR #3757). `resolveTransport` in `provider.js` implements the match and defaults when nothing matches. Node-declared transports (Generic Provider capabilities) are supplied by the caller on `credentials`, because node config is not part of the static registry.

**Where:** `open-sse/handlers/chatCore.js`: `handleChatCoreInner` (the `useTransport` / `modelSupportedFormats` / `modelTargetTransport` block); `open-sse/services/provider.js`: `resolveTransport`; `open-sse/providers/registry/opencode-go.js`: transport definition; `tests/unit/minimax-transport-target-format.test.js`; `tests/unit/muse-responses-wire.test.js`

### D2. A timeout is surfaced, never retried; the non-stream timer outlives the call

`BaseExecutor` bounds time-to-headers for streaming requests. For non-streaming requests it bounds the whole call, because upstreams only send headers once the completion is done. A provider-specific `timeoutMs` bounds either of those. A gateway timeout says nothing about account health, and the request may already be billed upstream, so it is returned as 504 and the POST is not replayed. For non-stream calls the total timer must outlive `execute()` because the caller reads the body afterwards, so `dispose()` is handed back instead of clearing the timer in place. When a retry does happen, the stale response is cancelled before the sleep so an abort during the sleep cannot leave it open. A 502 from an edge is typically a poisoned keep-alive socket, so it is retried on a fresh one.

**Where:** `open-sse/executors/base.js`: `BaseExecutor.execute` and its `tryRetry` closure

### D3. Stored `apiType` is authoritative for openai-compatible nodes

The `apiType` persisted on the connection's `providerSpecificData` (kept in sync with the node on create/update) decides chat vs responses. Only legacy nodes created before `apiType` was persisted fall back to the node ID substring (`openai-compatible-<chat|responses>-<uuid>`). Deriving the type from the immutable node ID made editing a node's `apiType` to "responses" a silent no-op.

**Where:** `open-sse/services/provider.js`: `resolveOpenAICompatibleApiType`; `tests/unit/openai-compatible-apitype-resolution.test.js`

### D4. Claude `tool.type` is defaulted only for gateways that declare `requireClaudeToolType`

The Claude tool schema wants `type` set, and strict gateways (MiniMax) answer 400 when it is missing, so chatCore defaults it to `"custom"` where the provider quirk `requireClaudeToolType` is declared (`shouldDefaultClaudeToolType`). Applying it everywhere breaks Claude-format endpoints that only accept the legacy typeless shape. DeepSeek's Anthropic-compatible endpoint answers 400 "unknown variant `custom`" (#3905). See also ADR-0020.

**Where:** `open-sse/handlers/chatCore.js`: `handleChatCoreInner` (call to `shouldDefaultClaudeToolType`)

### D5. Kenari `/v1/responses` is normalized in chatCore, and converted tools are restored on the way out

Kenari's Responses endpoint honours only a subset. chatCore converts `custom` tools to `function` tools (freeform `input` param) and drops `text.format` structured outputs. Same-format passthrough skips translation, so this is the only normalization point. The converted names ride on `_customToolNames`. The non-streaming handler uses them to surface `function_call` output items as `custom_tool_call` so Codex recognizes them.

**Where:** `open-sse/handlers/chatCore.js`: `handleChatCoreInner` (Kenari normalization); `open-sse/handlers/chatCore/nonStreamingHandler.js`: `handleNonStreamingResponse` (custom_tool_call rewrite)

### D6. Responses upstreams always stream, so non-stream clients take the SSE-to-JSON path

The Responses wire always streams upstream (`openaiToOpenAIResponsesRequest` pins `stream: true`). A non-stream OpenAI or native client behind a Responses upstream must therefore take the forced-SSE path. `handleForcedSSEToJson` returns null when the body is not SSE. The Responses-shaped conversion in `sseToJsonHandler.js` is inlined rather than imported from `nonStreamingHandler.js`, because `nonStreamingHandler` already imports `parseSSEToOpenAIResponse` from that module and a shared import would cycle. Bodies with `object: "response"` have no `choices`, so Chat-specific post-processing is skipped for them.

**Where:** `open-sse/handlers/chatCore.js`: `handleChatCoreInner` (forced SSE branch); `open-sse/handlers/chatCore/sseToJsonHandler.js`: Responses conversion; `open-sse/handlers/chatCore/nonStreamingHandler.js`: `handleNonStreamingResponse`

### D7. Non-stream Claude bodies are always translated; OpenAI-native bodies pass through

A Claude-format body is translated to OpenAI even when `content` is missing or null. For example, M3 with `max_tokens: 1` spends the budget on thinking and returns `content: null`. Returning the raw body would leave the client with no `choices` array, surfacing as a UI test error. The exception is a response that already has `choices` or non-array `content`. Some providers (xiaomi-tokenplan) return OpenAI-native bodies even when the request was translated to Claude. `reasoning_content` is stripped only when `content` is non-empty, since a thinking model that used all its tokens on reasoning has nothing else useful to return. Code-fence markers are stripped only when the provider wrapped the whole answer in a ```json fence (kimi), so a trailing fence from a normal answer survives. The finish reason uses the shared mapping so MAX_TOKENS becomes `length` and SAFETY becomes `content_filter`, matching the streaming path.

**Where:** `open-sse/handlers/chatCore/nonStreamingHandler.js`: `handleNonStreamingResponse` (Claude-body translation, `reasoning_content` stripping, fence stripping, finish-reason mapping)

### D8. Translator-internal continuity fields are stripped from the outbound body

The Responses to Chat translator stashes reasoning `encrypted_content` on assistant messages so a later openai to responses round trip can restore the `store=false` continuity blob. That stash must never reach an upstream. Chat-native proxies reject the unknown assistant-message field and answer every turn with a literal "400" body (seen with multi-turn Codex sessions through OpenAI-compatible nodes).

**Where:** `open-sse/handlers/chatCore.js`: `stripContinuityFields`

### D9. Late-stage body shaping: cache breakpoints and model quirks run last

Cache breakpoints are pinned to the final body after every token saver, because the savers can reshape system, tools and messages and a stale anchor costs a full prefix rewrite (see ADR-0018). Model quirks from `config/providerModels.js` (for example OpenCode Go GPT-5.6 Luna Responses rejecting sampling controls and requiring a minimum output-token budget) are applied after all request transforms and just before the executor. Clients send `temperature` by default and probes use tiny budgets, so applying the quirks earlier would let a later transform undo them.

**Where:** `open-sse/handlers/chatCore.js`: `handleChatCoreInner` (cache anchor call, model-quirk normalization)

### D10. Provider header hooks run before auth is applied

In `DefaultExecutor.buildHeaders`, dynamic header hooks run first and `applyAuth` runs after them, so a hook-written overlay can never clobber the auth token.

**Where:** `open-sse/executors/default.js`: `DefaultExecutor.buildHeaders`

### D11. Module graph boundaries are kept one-way

`getExecutor` is a long-standing synchronous public API (provider tests, CLI consumers, internal callers), so it stays sync while specialized executors are constructed lazily rather than all at module load. `claudeCliVersion` resolves the proxy-aware fetch lazily, because a static import would cycle `proxyFetch` to `claudeCliVersion`. pxpipe's `opts.transform` is injected by the `src/` host so `open-sse` stays free of filesystem and install concerns and remains usable standalone.

**Where:** `open-sse/executors/index.js`: `getExecutor`; `open-sse/utils/claudeCliVersion.js`: lazy fetch resolver; `open-sse/rtk/pxpipe.js`: `opts.transform`

### D12. Cursor AgentService output is already OpenAI-compatible

Most executors return their registry format. The Cursor AgentService executor is the exception: it decodes its protobuf stream into OpenAI-compatible output itself, so chatCore must not treat it as its registry format.

**Where:** `open-sse/handlers/chatCore.js`: `handleChatCoreInner` (response-format selection after the executor call)

### D13. One header name is deliberately mis-cased

The `retry-after` header in `unavailableResponse` is intentionally lower-case, unlike the canonical `Retry-After`, to prevent duplicate headers. Do not "fix" the casing.

**Where:** `open-sse/utils/error.js`: `unavailableResponse` (the `retry-after` header)

## Consequences

- Dropping the per-model `supportedFormats` guard sends kimi/glm to `/messages`, or posts Responses bodies to Chat Completions URLs (400 "unknown parameter `input`").
- Replaying timed-out POSTs risks double billing and wrongly penalizes accounts. Clearing the non-stream timer early lets calls hang or aborts the body read.
- Leaking `encrypted_content`, or defaulting `tool.type` everywhere, makes strict Chat or Claude-format upstreams return 400 (DeepSeek, #3905).
- Reordering header hooks after auth, or early cache anchoring, silently breaks auth or cache hits.
- Static imports that create cycles (`proxyFetch`, `nonStreamingHandler`), or making `getExecutor` async, break module load order and external callers.
