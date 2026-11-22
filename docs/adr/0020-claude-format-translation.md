# ADR-0020: Claude message and tool translation

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

The Claude wire format is translated in several places. `open-sse/translator/formats/claude.js` holds `prepareClaudeRequest` and the Claude passthrough normalizer. `translator/request/openai-to-claude.js` and `claude-to-openai.js` handle the OpenAI pivot. The response translators handle streaming, and `utils/claudeRequestFallback.js` adapts a request after a rejection. Anthropic and the Anthropic-compatible gateways (DeepSeek, MiniMax, Zed, z.ai, Kimi) are strict in different and sometimes contradictory ways. Combos also mix providers, so foreign block shapes leak into the Claude history. Most rules below are a fix for a specific 400 that otherwise kills the request before combo fallback can help.

## Decisions

### D1. Tool `type` is defaulted to `custom` only for gateways that need it; DeepSeek only gets whitelisted types

Claude's tool schema wants an explicit `type`. Strict gateways (the MiniMax Anthropic-compatible endpoint, error 2013) reject legacy typeless tools with 400. `defaultClaudeToolType` fills `{ ...tool, type: "custom" }` (spread first, override last, so falsy `type` values such as null, undefined or "" do not survive) and leaves tools with a truthy `type` (`computer_use`, `bash`, `web_search_20250305`) untouched. `shouldDefaultClaudeToolType` applies it only to providers that declare the `requireClaudeToolType` quirk. Applying it globally breaks endpoints that only accept the legacy typeless shape (DeepSeek answers 400 "unknown variant `custom`", #3905). DeepSeek's Anthropic-compatible endpoint (`/anthropic/v1/messages`) accepts only the built-in `web_search_*` tools and rejects client-defined `custom` tools (MCP, Read, Bash). The provider declares `quirks.claudeSupportedToolTypes`. When it is present, `prepareClaudeRequest` keeps only those types and keeps their `type` field intact, because DeepSeek would reject a tool missing its discriminator with the same unknown-variant error. Without the whitelist, the older behaviour applies: drop every non-function tool and strip `type`, which is right for OpenAI-compatible targets reached through this pass. DeepSeek's OpenAI transport does not run `prepareClaudeRequest`.

**Where:** `open-sse/translator/concerns/toolCall.js`: `defaultClaudeToolType`, `shouldDefaultClaudeToolType`; `open-sse/translator/formats/claude.js`: `prepareClaudeRequest` (tool filtering); `open-sse/providers/registry/deepseek.js`: `quirks.claudeSupportedToolTypes`; `tests/translator/bugs-3905-deepseek-tool-type.test.js`; `tests/unit/deepseek-claude-tools.test.js`

### D2. Never forward a history Anthropic will reject: foreign blocks, orphaned results, empty content

A combo that mixes models leaks foreign shapes into the Claude history, and each of these makes Anthropic return 400 for every later turn. `server_tool_use` ids must match `^srvtoolu_[a-zA-Z0-9_]+$`. A combo falling back to a provider with its own tools (z.ai/glm emits OpenAI-style `call_` ids for `analyze_image`) leaves poisoned blocks, so they are dropped. A dropped `server_tool_use` leaves its result behind, and a `tool_result` referencing an undeclared id is rejected, so both halves go. Thinking blocks whose signature is not Claude's are dropped. Empty text blocks are dropped ("text content blocks must be non-empty"), and a message left with no content is dropped, never padded with an empty placeholder. `hasValidContent` counts a message as non-empty only if it has a listed block type. `container_upload` (Files API) is on that list because a user turn holding only a file reference is valid (#4316), and dropping it forwarded `messages: []` to the provider. Each `tool_use` must have its `tool_result` in the very next message, and `tool_result` blocks must lead a user message, so hoisted images follow them. Text after a `tool_use` in an assistant message is removed. The OpenAI to Claude path keeps each `tool_result` in a separate message immediately after the `tool_use`.

**Where:** `open-sse/translator/formats/claude.js`: `normalizeClaudePassthrough`, `hasValidContent`, `isContentfulBlock`, `hasForeignServerToolUseId`, `fixToolUseOrdering`, `hoistToolResultImages`; `open-sse/translator/request/openai-to-claude.js`: `openaiToClaudeRequest`; `tests/unit/claude-foreign-server-tool-use.test.js`; `tests/unit/claude-container-upload.test.js`

### D3. A request must not end on an assistant turn unless the client chose that

Newer Claude models reject a body ending on an assistant turn ("does not support assistant message prefill"). Cleanup passes delete emptied messages, so an emptied trailing user turn silently makes the previous assistant turn the last one. `ensureTrailingUserTurn` restores a user turn ("Continue.") only when the client did not itself end on assistant, since real prefill is the client's choice. For non-`messages[]` sources (Gemini `contents[]`, Responses `input[]`) the terminal role lives in the source's own shape, so an explicit trailing model/assistant turn survives and only an emptied trailing user turn is restored. Mid-conversation system text is wrapped in `<instructions>` tags so it ends as a user turn and avoids the same prefill 400.

**Where:** `open-sse/translator/formats/claude.js`: `ensureTrailingUserTurn`; `open-sse/translator/request/claude-to-openai.js`: `convertClaudeMessage`; `tests/unit/claude-trailing-user-turn.test.js`; `tests/unit/claude-trailing-user-turn-source-formats.test.js`

### D4. Bare content objects are wrapped before anything folds them; system folds are copy-on-write

Some clients send `content: {block}` rather than `content: [{block}]` (the spec allows string or array). Normalization wraps it as a one-element array before the mid-conversation-system fold, which assumes the array shape. Otherwise a bare-object neighbour would be zeroed to `[]`. The same normalization runs first in `claude-to-openai.js`, before the role branch, because `systemReminderText` only reads arrays and strings and a bare-object system turn was dropped outright. Folding is copy-on-write, because the caller's body is reused across account-fallback attempts and must never be mutated.

**Where:** `open-sse/translator/formats/claude.js`: `normalizeClaudePassthrough`; `open-sse/translator/request/claude-to-openai.js`: `convertClaudeMessage`, `systemReminderText`

### D5. `max_tokens` is clamped to the model ceiling, then reconciled with the thinking budget

`max_tokens` is clamped to the model's real output ceiling from its capabilities (`maxOutput`, 128000 for Opus 4.8 and Sonnet 4.6), falling back to the conservative 64000 default. `applyThinking` runs after `adjustMaxTokens` has capped `max_tokens`, and the claude-budget format maps max effort to `budget_tokens` 128000, which can exceed the clamped `max_tokens`. Anthropic requires `max_tokens` strictly greater than `budget_tokens` (else 400). The code prefers raising `max_tokens` to keep the requested thinking depth. If the budget alone meets or exceeds the ceiling, it caps output and shrinks the budget so tokens remain for the answer.

**Where:** `open-sse/translator/formats/claude.js`: `prepareClaudeRequest` (max_tokens clamp and budget reconciliation)

### D6. Model-specific thinking rules and request quirks

Haiku 3.x/4.x reject `thinking.type: "adaptive"` and `output_config.effort`, while Haiku 5+ accepts only adaptive (#5183). The version may follow "haiku" (haiku-4-5, haiku-4.5) or precede it (claude-4.5-haiku, claude-3-5-haiku), and unversioned "haiku" keeps the old safe downgrade. DeepSeek (official and behind OpenCode Go's `/messages`) requires a thinking block in thinking mode but not Anthropic's signed-thinking fallback, so it gets keep/placeholder handling (verified live 2026-08-15, PR #3332). MiniMax's Claude-compatible endpoint rejects `output_config` (400 invalid params), so it is omitted. OpenAI-compatible clients echo streamed `reasoning_content` back, and the OpenAI to Claude translator turns it into a thinking block, minus `cache_control`, so prior reasoning is not lost.

**Where:** `open-sse/translator/formats/claude.js`: `isAdaptiveThinkingUnsupported`, `handlesThinkingBlocks`, `buildThinkingPlaceholder`, `prepareClaudeRequest`; `open-sse/translator/request/openai-to-claude.js`: `getContentBlocksFromMessage`

### D7. Rejection fallback: adapt the request once when Anthropic says so

Some Claude models reject options that others accept. Rather than keep a per-model table, `adaptClaudeRequestAfterRejection` adapts the request once based on the upstream error message: `tool_choice` types "tool" and "any" unsupported, "thinking disabled" unsupported (use `between_tools`), and `thinking.type.disabled` unsupported (keep thinking minimal via adaptive plus `output_config.effort`).

**Where:** `open-sse/utils/claudeRequestFallback.js`: `adaptClaudeRequestAfterRejection`

### D8. OpenAI to Claude tool conversion follows Anthropic's strict schema

Anthropic only accepts tool names matching `^[a-zA-Z0-9_-]{1,128}$`, and MCP `server.tool` names do not, so names are sanitized. Function-shaped tools come in two flavours, `{type:"function", function:{name}}` and the loose `{function:{name}}` without a parent `type`. Both must yield a real name. Treating the bare shape as a function tool matters because MiniMax M3 (api.minimaxi.com) rejects `name: "undefined"` with code 2013 "invalid tool type" (#2435, follow-up to PR #2463). `tool_choice` must be one of auto, any, tool, none, and anything else (OpenAI's "function") is a 400, so an unrecognized type is never passed through. The OpenAI forced-tool shape is checked before the native pass-through because it also carries a `.type`. `parallel_tool_calls: false` maps to `tool_choice.disable_parallel_tool_use`, which is not valid with type "none". Tool-message content arrays are converted because Claude `tool_result` accepts image blocks but not OpenAI `image_url` parts. `is_error` is always emitted as a bool on `tool_result`, because Zed's Anthropic wire types and other strict serde parsers require it, and Anthropic treats it as optional (default false). Claude OAuth requires prefixed tool names, which the request side currently emits as an empty prefix.

**Where:** `open-sse/translator/request/openai-to-claude.js`: `openaiToClaudeRequest`, `convertToolResultContent`, `buildToolResultBlock`, `resolveToolResultIsError`, `convertOpenAIToolChoice`; `tests/unit/openai-to-claude-tools-no-type.test.js`; `tests/unit/openai-to-claude.test.js`

### D9. Images in tool results are moved to user content for non-Anthropic endpoints

Anthropic itself reads images inside `tool_result`, but other Anthropic-compatible endpoints (OpenCode Go, Kimi, DeepSeek, GLM, MiniMax) accept image blocks only as user content and silently drop them inside a tool result. `hoistToolResultImages` moves the screenshot into the same user turn. In the Claude to OpenAI direction the tool role is text-only, so images a tool returned are handed over in the user turn following the tool messages, tagged with the originating call.

**Where:** `open-sse/translator/formats/claude.js`: `hoistToolResultImages`; `open-sse/translator/request/claude-to-openai.js`: `convertClaudeMessage`

### D10. anthropic-compatible nodes fronting real Claude models get Anthropic's beta flags

An `anthropic-compatible-*` node serving a Claude model sits in front of Anthropic itself (a rotating multi-account proxy, a corporate gateway), so it needs the same beta flags as the `claude` provider. Without `context-management-2025-06-27`, upstream rejects the `context_management` block Claude Code sends in every request ("Extra inputs are not permitted", 400), and the combo silently falls through. The model id (`claude-*`) gates this, so a node fronting Kimi or GLM never matches and gateways that would choke on unknown beta flags are untouched. For non-Anthropic anthropic-compatible upstreams the first-party Claude Code identity headers are stripped, and Bearer auth is sent in addition to `x-api-key`, since some gateways read only one of them.

**Where:** `open-sse/executors/default.js`: `DefaultExecutor.buildHeaders`

### D11. Claude response translation: streaming and non-streaming details

Thinking travels only in `reasoning_content`. `<think>` markers in content are not emitted because OpenAI-format clients render them as literal text. A no-argument tool never gets an `input_json_delta`, so a valid empty JSON argument string is still produced. In the OpenAI to Claude stream, a block is opened once per index. GLM/fireworks repeat id plus null name on every argument chunk, while other providers open the index with no id at all, so one is minted rather than dropping the call and its buffered arguments. Upstreams report usage on the finish chunk or on a trailing chunk with `choices: []`. Emitting `message_delta` immediately would freeze estimated usage, so completion is deferred while real counts are missing, and closing is idempotent (`closeOpenBlocks`, `flushClaudeStream`) because a finish chunk, a usage trailer or the terminal flush can all end the stream. The legacy `proxy_` tool-name prefix is still stripped on responses, a no-op with the current empty request prefix, and must not be coupled to the request side. Anthropic's API-level refusal (`stop_reason: "refusal"`, zero output tokens, `stop_details`) must reach OpenAI clients as `finish_reason: "content_filter"` with the explanation, and not as an empty "stop" (captured live 2026-09-20 against claude-opus-5). The bypass handler merges `message_start.usage` (input and cache) with `message_delta.usage` (final output tokens) so cache counts survive. The non-stream handler decloaks `tool_use` names once on the raw Claude body before any translation.

**Where:** `open-sse/translator/response/claude-to-openai.js`: `claudeToOpenAIResponse`; `open-sse/translator/response/openai-to-claude.js`: `openaiToClaudeResponse`, `closeOpenBlocks`, `emitCompletion`, `flushClaudeStream`; `open-sse/translator/schema/finishReasons.js`; `open-sse/utils/bypassHandler.js`: `mergeChunksToResponse`; `open-sse/handlers/chatCore/nonStreamingHandler.js`: `handleNonStreamingResponse`; `tests/unit/claude-refusal-stream.test.js`

### D12. Zed requires a bare `is_error` bool on every tool_result

Zed's `cloud.zed.dev` parses `provider_request` with Zed's Anthropic types, where `ToolResult.is_error` is a required bool. Omitting it fails the request. This is why the OpenAI to Claude translator always emits `is_error`.

**Where:** `open-sse/translator/request/openai-to-claude.js`: `resolveToolResultIsError`; `tests/unit/openai-to-claude.test.js`

## Consequences

- Dropping the quirk gating on `tool.type` breaks either MiniMax (typeless tools, 400 2013) or DeepSeek (`custom` rejected, #3905).
- Skipping history cleanup (foreign thinking signatures, `call_` ids, orphaned results, empty blocks) makes every subsequent turn in a mixed combo return 400, and the combo cannot recover.
- Omitting the trailing-user restoration breaks newer Claude models ("assistant message prefill"), and doing it unconditionally breaks legitimate prefill.
- Skipping the `max_tokens`/`budget_tokens` reconciliation gives 400 for max-effort thinking.
- Dropping `is_error`, `container_upload` or image hoisting silently loses data or fails on Zed and non-Anthropic gateways.
- Changing the response-side tool prefix, usage deferral or `<think>` handling corrupts client-visible streams (literal think tags, estimated usage, lost tool calls).
