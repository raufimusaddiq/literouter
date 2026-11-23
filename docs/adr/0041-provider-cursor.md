# ADR-0041: Cursor provider (AgentService over HTTP/2 + protobuf)

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Cursor is a binary/protobuf upstream, so it is handled inside its own executor rather than the OpenAI translator. The legacy ChatService rejects auto/composer and most thinking variants, so the executor prefers AgentService (`agent.api5.cursor.sh`), which is HTTP/2-only and uses Connect-style protobuf frames. Many failure modes here are silent (empty turns, stalled streams, dropped tool results), which is why the wire-level rules matter.

## Decisions

### D1. Use AgentService for text and tool turns; legacy protobuf only for images

ChatService rejects auto/composer and most thinking variants. AgentService answers text turns (including declared tool schemas) and tool-call history, so requests are routed there when `isAgentCapableRequest`; image parts still need the legacy protobuf path. "Auto (Server Picks)" / "default" is not a real AgentService model id and sending it verbatim returns an empty turn, so it is resolved to the account's default agent-capable model (preferring the picker's `defaultOn`, then the first usable agent model).

**Where:** `open-sse/executors/cursor.js`: `isAgentCapableRequest`, `executeAgent`; `open-sse/services/cursorModels.js`: `resolveAutoModelSelection`

### D2. HTTP/2 is mandatory; unary catalog calls use unframed protobuf

AgentService is HTTP/2-only. Node fetch/undici speaks HTTP/1.1 and fails with HTTPParserError on the h2 preface, so the executor uses `http2` duplex streams and the model fetcher uses `node:http2`. Connect unary calls (`GetUsableModels`) use an unframed protobuf body (`application/proto`), unlike chat's streaming `application/connect+proto`. Cursor also does not support compressed requests.

**Where:** `open-sse/executors/cursor.js`: `openAgentHttp2Stream`; `open-sse/services/cursorModels.js`: `http2PostProto`, `fetchCursorCatalog`; `open-sse/utils/cursorProtobuf.js`: `generateCursorBody`; `tests/unit/cursor-models.test.js`

### D3. The AgentRun request frame has exact requirements

`custom_system_prompt` (RunRequest field 8) makes AgentService return an empty turn, so system text is folded into the current user message. `UserMessageAction` needs `selected_context` (field 3) and `mode=1` (field 4) to match cursor-agent's wire format, or the server may accept the RPC and stream an empty turn. ModelDetails (field 3) is required for thinking variants (Composer, Grok, `*-thinking`); setting only RequestedModel (field 9) returns an empty turn. Tools already go out on `AgentRunRequest.mcp_tools`; echoing them again on the request-context ack makes AgentService stall silently (0 SSE bytes until abort).

**Where:** `open-sse/executors/cursor.js`: `buildAgentRunFrame`, `createRequestContextResponse`

### D4. Server-initiated requests are answered, rejected or acked so the stream continues

Auto/Composer often probe IDE builtins (shell, read, ...). Those exec requests are rejected so the model can continue with MCP tools or a text answer instead of stalling the h2 stream. Diagnostics has no rejected variant, so an empty success unblocks the stream. KvServerMessage asks the client to get (field 2) or set (field 3) a blob, and the ack MUST echo the server's metadata (field 4) verbatim; dropping it desynchronises AgentService session state (the echo was missing before c933eefc and is now locked by a test).

**Where:** `open-sse/executors/cursor.js`: `rejectExecRequest`, exec handling in `executeAgent`; `tests/unit/cursor-kv-metadata-roundtrip.test.js`

### D5. Stream output rules

Composer (and some Grok variants) put the visible answer after `</think>` in `thinking_delta` (field 4) and never send `text_delta`, so thinking deltas are handled. A single read can carry several frames; once the turn is over the rest of the batch must not reach the already-closed controller. The Claude SSE translator derives Anthropic's message ID by stripping `chatcmpl-`, so the remaining ID is kept in Anthropic's required `msg_` form so strict clients such as Claude Code accept the completed stream. A protocol failure is emitted as an SSE error frame, not a content delta, so it is not shown as the assistant's reply and usage tracking does not record the turn as a success.

**Where:** `open-sse/executors/cursor.js`: `executeAgent`

### D6. Messages arrive pre-translated; tool outputs are text for stability

Messages are already translated by chatCore (claude to openai to cursor) so `transformRequest` must NOT call `openaiToCursorRequest` again: double translation drops `tool_results`. Cursor can loop when tool outputs are sent via protobuf `tool_results` with partial schema mismatches, so the legacy translator represents tool outputs as structured text blocks in user messages. Mixed assistant payloads (tool calls and results in one message) are split into separate assistant messages to avoid protobuf encoding errors.

**Where:** `open-sse/executors/cursor.js`: `transformRequest`; `open-sse/translator/request/openai-to-cursor.js`; `open-sse/utils/cursorProtobuf.js`: `encodeRequest`

### D7. Tool call ids carry a model_call_id delimiter

Cursor uses `"\nmc_"` as the delimiter for `model_call_id` inside `tool_call_id`, and returns multi-line ids where only the first line is the id.

**Where:** `open-sse/utils/cursorProtobuf.js`: `parseToolId`, `extractToolCall`

### D8. Imported tokens are not validated against the API

Token import from the Cursor IDE (`state.vscdb`) skips API validation because the Cursor API uses complex protobuf; the token is validated when first used for a real request. Only the machine id's UUID format is checked.

**Where:** `src/lib/oauth/services/cursor.js`: `validateImportToken`

## Consequences

- Using fetch/undici for AgentService, or re-translating via `openaiToCursorRequest`, fails with parser errors or drops tool results.
- Sending a system prompt field, echoing tools on the ack, or omitting ModelDetails produces empty or stalled turns with no error.
- Not echoing KV metadata, or letting frames reach a closed controller, desynchronises sessions and throws late errors.
- Rendering protocol errors as content makes failures look like successful replies and corrupts usage stats.
