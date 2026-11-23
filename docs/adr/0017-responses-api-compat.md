# ADR-0017: OpenAI Responses API compatibility

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Codex CLI, Grok CLI, GitHub Copilot CLI and other clients speak the OpenAI Responses API, while most upstreams speak Chat Completions, Claude or Gemini formats, and some upstreams speak a stricter or reduced Responses subset (Codex backend, OpenCode Go, Kenari). The translators in `open-sse/translator/` pivot through the OpenAI Chat format, and the Responses converters must reproduce details that real clients parse strictly: item ids, tool shapes, reasoning continuity under `store=false`, and the `response.completed` event. Many of the rules below came from concrete client failures.

## Decisions

### D1. response.completed must carry usage and output, and must always arrive

Codex compacts history only from the usage reported on `response.completed`; without it the context gauge stays at 0 and a long session eventually exceeds the model context (issue 9router#3432). Its parser requires the three top-level counts (all required i64) and treats the detail fields as optional but each required when present, so dropping one discards the whole event and kills the turn. The terminal event must be last, because Codex stops reading there. Responses usage is stored in `state.responsesUsage`, never `state.usage`: the stream layer owns `state.usage` (normalized shape, used for logging and cost) and overwriting it would silently drop cached and reasoning tokens. The terminal event must also repeat items already delivered via `response.output_item.done` in `response.output` (issue #4307); clients that build their result from it (GitHub Copilot CLI 1.0.89, SDK "final response" helpers) otherwise report "No response was returned". Output is keyed by `output_index` (repeated close overwrites) and ordered by it; it is created lazily because `stream.js` may supply its own state.

**Where:** `open-sse/translator/response/openai-responses.js`: usage capture, `sendCompleted`, `flushEvents`; `tests/unit/openai-responses-completed-usage.test.js`; `tests/unit/responses-completed-output.test.js`

### D2. Defer completion until usage is known, with a watchdog, but not across a pivot

Upstreams report usage on the finish chunk or on a trailing chunk with empty `choices` (OpenAI), and some attach zeroed placeholders to every chunk, so usage is captured before the choices guard and real counts are awaited. When `finish_reason` arrives without usage, completion is deferred to `flushEvents()`; if the upstream then stalls, a watchdog flushes the terminal event after `PENDING_COMPLETION_FLUSH_MS` (PR #4476). Deferral only holds on the direct `openai:openai-responses` route. When the converter is the second hop of a pivot (Claude/Gemini/Kiro upstream), `translateResponse()` drops the terminal null chunk, so `flushEvents()` never runs and deferring would swallow the terminal event; there completion stays on the finish_reason branch. Usage must also survive the pivot: Anthropic splits counts across `message_start` (prompt side) and `message_delta` (output only), so the Claude converter merges them into state before emitting the intermediate chunk.

**Where:** `open-sse/translator/response/openai-responses.js`: finish handling; `open-sse/translator/index.js`: `translateResponse`; `open-sse/utils/stream.js`; `tests/unit/openai-responses-completion-watchdog.test.js`, `tests/unit/openai-responses-usage-pivot.test.js`, `tests/unit/openai-responses-usage-completed.test.js`

### D3. store=false continuity needs reasoning items and encrypted_content, except where upstreams cannot validate them

Backends run with `store=false` (Codex, Grok CLI, xiaomi-mimo), so multi-turn continuity depends on re-sending prior reasoning. Reasoning text is buffered and attached to the next assistant turn, `encrypted_content` is stashed so a later openai to responses hop can restore the continuity blob, and a reasoning input item is rebuilt from Chat assistant fields. The Codex executor requests reasoning encrypted content explicitly. Native Grok ids are required for encrypted continuity. The opposite rule applies for pooled or rotating accounts: OpenCode Free (`Bearer public`) and the Muse Spark models of OpenCode Go route to backend account pools where `encrypted_content` cannot be validated across accounts, relays or sessions, giving 400 "reasoning encrypted_content was not issued to this caller", so prior-turn reasoning items are stripped there. Never let a client-scoped `previous_response_id` reach upstream: with `store=false` it can never resolve and the backend answers 400.

**Where:** `open-sse/translator/request/openai-responses.js`: reasoning buffering and `buildReasoningItem`; `open-sse/executors/codex.js`; `open-sse/executors/opencode-go.js`; `open-sse/executors/opencode.js`; `tests/unit/openai-responses-multiturn.test.js`, `tests/unit/opencode-muse-spark-thinking.test.js`

### D4. Strip server-generated item ids and unsupported fields for Codex

Codex `/responses` cannot resolve server-generated item ids (`rs_`, `fc_`, `resp_`, `msg_`) when `store=false`; sending them gives 404, so they are stripped from input (the same sanitization is applied by OpenCode Go). A final allowlist filter drops any unknown field that could trigger upstream `routing_unsupported`; `previous_response_id` and similar fields sent by Droid CLI are removed because Codex does not support them. System prompts stay in `body.input` as `role=developer` so they remain in the cacheable prefix. A `service_tier` of "fast" is mapped to "priority".

**Where:** `open-sse/executors/codex.js`: `SERVER_ID_PATTERN`, final allowlist, `convertSystemToDeveloperRole`; `open-sse/executors/opencode-go.js`; `tests/unit/opencode-go-executor.test.js`

### D5. Tool declarations and call items must be valid for strict upstreams

Strict Responses upstreams reject nameless or overlong tool declarations and calls (#444, #393), so nameless calls are skipped and call ids shortened. Hosted tools (for example `request_user_input`) have no `name` and cannot be Chat function declarations; they are filtered out so Gemini, which validates names strictly, never sees them. Custom (freeform) tools are exposed to Chat as functions with one raw `input` string, with their names retained in `body._customToolNames` for the reverse conversion. `{type:"object"}` without `properties` is rejected (Codex and strict backends), so an empty properties map is filled in. Arguments are stringified once: objects become JSON, valid JSON strings pass through, anything else (partial fragments, empty) becomes `"{}"` to avoid double-encoding and `InputValidationError`. `function_call_output.output` must be a string, never null or an object. OpenCode Go flattens Chat tool declarations to the Responses flat shape and drops hosted or nameless tools; for native Responses clients (source equals target, no translation) it coerces items in place as a last line of defense so bad payloads 400 locally with a clear shape.

**Where:** `open-sse/translator/formats/responsesApi.js`; `open-sse/translator/request/openai-responses.js`; `open-sse/executors/opencode-go.js`

### D6. Parallel and multi-item tool calls are keyed by item id

When converting a Responses stream to Chat chunks, the Chat tool-call index is assigned when the call is added (not when done) and routed by `item_id`. Attributing deltas by stream position merges parallel calls into index 0 when upstream emits all `output_item.added` events before any done, and the client then concatenates several JSON payloads into one invalid tool input. Done events only emit full arguments if no deltas were sent (some upstreams send complete arguments only at done); `currentToolCallId` is deliberately sticky for the turn so flush can still finalize as `tool_calls`. Some compatible providers split the call id and name across chunks, so the converter waits for both before deciding custom versus function; otherwise an `exec` call could be irreversibly announced as function_call. Custom tool input is emitted once at close after unwrapping the JSON wrapper, because streaming raw fragments would show `{"input":"..."}` instead of the freeform program Codex expects. Providers such as codebuddy attach `tool_calls: []` to every chunk, and an empty array is truthy, so the guard must test length or the message closes at the first content token and truncates the answer.

**Where:** `open-sse/translator/response/openai-responses.js`; `tests/unit/responses-parallel-tool-calls.test.js`, `tests/unit/openai-responses-empty-toolcalls.test.js`

### D7. Kenari /v1/responses quirk: custom tools are converted to function tools and back

The Kenari subset honors only flat `type:"function"` tools; `custom`, `web_search`, `local_shell` are silently dropped and `text.format` structured outputs get HTTP 400, yet Codex CLI relies on exactly those (its `exec` tool is `type:"custom"` and recap turns send `text.format` json_schema). Providers with `quirks.responsesFunctionToolsOnly` get compensation: custom tool becomes a function tool with one freeform `input` string, `text.format` is stripped, and function_call items and events for converted names are rewritten to `custom_tool_call` so Codex still sees its native wire events. History replay is converted too (`custom_tool_call(_output)` to `function_call(_output)`, ids `ctc_`/`ctco_` to `fc_`/`fco_`), otherwise the model cannot see its prior exec calls and reports a tooling outage. Freeform input must arrive whole (Codex applies pragmas on the full text), so streamed JSON argument fragments are dropped. Same-format streams run through a per-event rewrite hook in `stream.js`, kept in TRANSLATE mode so event-name capture, terminal detection and `[DONE]` synthesis still apply.

**Where:** `open-sse/translator/concerns/responsesFunctionTools.js`; `open-sse/handlers/chatCore/streamingHandler.js`; `open-sse/utils/stream.js`

### D8. Normalize inputs and non-streaming responses defensively

An empty `input[]` becomes a placeholder user message, since it would otherwise produce `messages:[]`, which every provider rejects (#389). Items without `type` but with a role (Droid CLI) are treated as messages. Responses passthrough tolerates compatible clients that send a single content block object, and normalizes Chat's `max_tokens` after translation, since Responses providers reject both shapes. Responses-API providers (for example Codex) may emit SSE without a content-type and with the Responses output shape, so the SSE-to-JSON handler branches on the upstream format (not the client's): a Responses client behind a chat-native forced-streaming provider still receives chat chunks. It picks the last non-empty message among many alternating reasoning and message items, includes `custom_tool_call` items in the Chat pivot (otherwise those calls vanish), and surfaces a failed stream or one with no terminal event and no output as an error instead of an empty 200 that clients read as "no tool call". Closing "thinking" happens when the answer starts, since reasoning_content upstreams never emit `</think>`.

**Where:** `open-sse/translator/formats/responsesApi.js`; `open-sse/translator/index.js`; `open-sse/handlers/chatCore/sseToJsonHandler.js`; `open-sse/translator/request/openai-responses.js`

### D9. Provider and client routing limits

GitHub Copilot's `/responses` endpoint serves only OpenAI (gpt/codex) models; Gemini and Claude models must never be routed or escalated there, or they fail with a misleading 400 "does not support Responses API" (#1062). Headroom compression must keep `body.input` Responses-shaped rather than treating it as OpenAI messages (#1998).

**Where:** `tests/unit/github-responses-routing.test.js`; `tests/unit/headroom-responses-format.test.js`

## Consequences

- Missing or reshaped usage on `response.completed` makes Codex never compact; a malformed usage struct kills the whole turn.
- Deferring completion in a pivot or without a watchdog loses the terminal event or hangs clients.
- Sending reasoning ids and `encrypted_content` to account pools, or keeping server item ids with `store=false`, produces 400 and 404 errors; dropping them from Codex multi-turn breaks continuity.
- Attributing tool deltas by position merges parallel calls; empty `tool_calls: []` arrays truncate answers.
- Without the Kenari compensation Codex loses its shell tool and structured output.
- Nameless or oversized tool items, empty input arrays and non-string outputs are rejected upstream.
