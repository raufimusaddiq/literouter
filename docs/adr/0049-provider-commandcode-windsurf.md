# ADR-0049: CommandCode and Windsurf providers

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

CommandCode and Windsurf are non-OpenAI-compatible upstreams. CommandCode returns AI SDK v5 NDJSON from `api.commandcode.ai/alpha/generate`; Windsurf speaks Codeium gRPC-web protobuf. Both are handled by dedicated executors and translators. The schema facts below were verified live (curl, 2026-05-07 for CommandCode) and are easy to get wrong.

## Decisions

### D1. CommandCode request shape (OpenAI to CommandCode)

The `/alpha/generate` schema is: `params.system` is a top-level STRING (Anthropic-style; system messages are not allowed in `messages[]`); `params.messages[*].role` is one of user, assistant, tool; `content` is always an array of content blocks, never a string; images (`image_url` or image source) become `{type:"image", image:"data:...;base64,...", mimeType}`; assistant tool_use becomes `{type:"tool-call", toolCallId, toolName, input}`; user tool_result becomes `{type:"tool-result", toolCallId, toolName, output}`; tools are Anthropic-plain `{name, description, input_schema}`. Auth is `Bearer user_xxx` (the connection's apiKey) plus a per-request `x-session-id` header. The upstream accepts either spelling of the tested fields, and the translator emits both.

**Where:** `open-sse/translator/request/openai-to-commandcode.js`; `open-sse/executors/commandcode.js`; `tests/unit/openai-to-commandcode.test.js`; `tests/translator/bugs-gemini-cursor-commandcode.test.js`

### D2. CommandCode responses are translated inside the executor path to SSE chunks

Upstream emits NDJSON AI SDK v5 events, one JSON object per line with no `data:` prefix (start, start-step, reasoning-*, text-*, tool-input-start/delta/end, tool-call, finish-step with finishReason and usage, finish). Each is translated to an OpenAI `chat.completion.chunk` and emitted as SSE so streaming and non-streaming (forced SSE then JSON) handlers consume it without further format translation. The consolidated `tool-call` event is emitted only if no `tool-input-*` deltas were seen, to avoid duplicating the call. A mid-stream upstream error throws instead of becoming fake assistant text with `finish_reason:"stop"`, so the stream handler marks the stream errored/aborted.

**Where:** `open-sse/translator/response/commandcode-to-openai.js`; `open-sse/executors/commandcode.js`; `tests/unit/commandcode-to-openai.test.js`

### D3. CommandCode catalog is public but still gated by an existing connection

The catalog URL needs no auth and is account-independent, so no per-connection credentials are used to list it. The routes still require a configured, active connection (and the provider models route keeps its token guard), so an empty key cannot be used to enumerate it. Its per-model rates feed runtime pricing (see ADR-0024).

**Where:** `src/app/api/providers/[id]/models/route.js`; `src/app/api/v1/models/route.js`

### D4. Windsurf wire protocol and auth

Chat is gRPC-web over HTTPS (`Content-Type: application/grpc-web+proto`), service `exa.language_server_pb.LanguageServerService`, method `GetChatMessage` (unary request, streamed CompletionChunk frames). CompletionChunk is a oneof: field 1 ContentChunk {string text}, field 2 ToolCallChunk (skipped), field 3 DoneChunk {field 1 UsageStats {field 1 prompt_tokens varint, field 2 completion_tokens varint}}, field 4 ErrorChunk {string message}. The Codeium apiKey (`sk-ws-...` or Firebase-derived; `credentials.accessToken`) goes in the protobuf `Metadata.api_key` of every request and also as a Bearer header. Quota is a Connect RPC (protobuf) POST to windsurf.com `GetPlanStatus` with `Content-Type: application/proto`, `Connect-Protocol-Version: 1`, `X-Auth-Token: <session>`, body field1 session_token and field2 varint 1. Requests use dot-notation model ids that the executor's `MODEL_ALIAS_MAP` maps to Windsurf `modelUid`.

**Where:** `open-sse/executors/windsurf.js`; `open-sse/providers/registry/windsurf.js`

### D5. Windsurf auth chain has four terminal paths, all yielding an apiKey

1) OAuth web gives a Firebase JWT, then POST register.windsurf.com RegisterUser `{firebase_id_token}` returns `{apiKey, apiServerUrl, name}`. 2) A direct `sk-ws-...` key is used as metadata.apiKey on GetUserStatus. 3) A Firebase JWT (`eyJ...`) uses the same RegisterUser exchange. 4) A Devin `auth1_...` token goes through the self-serve chain to an `ide_token` used as apiKey on server.self-serve.windsurf.com. The apiKey is the long-lived terminal credential: no OAuth2 refresh_token grant yields a fresh one, so refresh is handled out-of-band by the caller.

**Where:** `open-sse/providers/registry/windsurf.js`; `open-sse/services/tokenRefresh/providers.js`

### D6. Windsurf stays hidden until it supports tool calls

The executor skips ToolCallChunk, so Windsurf (like trae SOLO agent) is commented out of the registry and absent from `PROVIDERS`. It must stay hidden until tool calling works, and tests assert that.

**Where:** `open-sse/providers/registry/index.js` (commented import and entry); `tests/unit/windsurf-executor.test.js`

## Consequences

- Sending a string `content`, a system role inside `messages[]`, or a non-Anthropic tool shape to CommandCode gets a schema 400.
- Emitting upstream errors as assistant text hides failures from fallback and from clients.
- Exposing Windsurf before tool calls work silently drops tool calls for agentic clients.
- Treating the Windsurf apiKey as refreshable attempts grants that do not exist.
- Dropping the connection requirement on catalog routes lets an unauthenticated caller trigger upstream catalog fetches.
