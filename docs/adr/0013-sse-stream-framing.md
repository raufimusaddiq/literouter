# ADR-0013: SSE stream framing, sentinels and finalization

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

`open-sse/utils/stream.js` builds the SSE streams (translate, passthrough, Responses rewrite) that sit between upstream providers and clients. Clients are strict about framing: they expect exactly one `data: [DONE]`, valid JSON, a terminal event even when the upstream misbehaves, and bytes arriving often enough not to time out. Upstreams are sloppy in many ways. These decisions record the invariants that stream code must keep.

## Decisions

### D1. The [DONE] sentinel is synthesized exactly once and never forwarded verbatim

In passthrough the upstream `data: [DONE]` is never forwarded; the stream synthesizes it once at the end, so forwarding it would produce two frames. An unterminated trailing `data: [DONE]` is dropped too, otherwise it glues onto the properly framed one appended at flush (#5592, producing `data: [DONE]data: [DONE]`). Chat Completions clients behind a translated upstream (Responses, Claude) never receive a sentinel from upstream, and strict clients such as OpenClaw hang until timeout (and trigger failover) without it, so it is appended. Every site that writes the sentinel must also mark it sent (PRD 20). Providers flagged `quirks.noDoneSentinel` (the Gemini family) reject it with 400 syntax errors, and Gemini clients end a stream by closing it, so it is suppressed for them. Responses clients (codex CLI) close on `response.completed` instead of [DONE].

**Where:** `open-sse/utils/stream.js`: `createSSEStream` (transform and flush); `open-sse/utils/sseConstants.js`: `SSE_DONE`; `open-sse/providers/registry/gemini.js`, `antigravity.js`, `vertex.js`: `quirks.noDoneSentinel`

### D2. After HTTP 200 a failure travels in-band as an error frame, never a fake finish

Once a stream aborts after the 200 was sent the status cannot change. `buildStreamErrorBytes` emits a structured error frame then [DONE] for OpenAI-compatible clients (openai-python raises APIError on any `data:` payload with an `error` key, checked before [DONE]), `event: error` for Anthropic clients, and a bare error for Gemini. It must never fabricate a successful `finish_reason`. The result is encoded bytes enqueued verbatim by the abort callbacks. The Ollama NDJSON case would get an SSE frame but is dead in practice since `detectFormatByEndpoint` never resolves to OLLAMA. A mid-stream error in the CommandCode translator likewise throws rather than emitting fake content with `finish_reason: "stop"`.

**Where:** `open-sse/utils/streamHelpers.js`: `buildStreamErrorBytes`; `tests/unit/responses-abort-terminal.test.js`

### D3. Finalize the usage/logging tail on client cancel as well as flush

A client that closes right after the terminal event (for example right after [DONE]) cancels the reader, and `flush()` never runs. The usage/logging tail is therefore a function callable from transform, flush and cancel, and a cancel after the terminal event counts as a normal completion.

**Where:** `open-sse/utils/stream.js`: `createSSEStream` (finalize and cancel handler)

### D4. Bound the deferred response.completed wait

A direct Chat-to-Responses translation may defer `response.completed` while waiting for a usage trailer. `[DONE]` ends that wait even if the upstream keeps the connection open. A broken chat upstream may also stall after `finish_reason` with neither usage nor [DONE], so a watchdog bounds the wait and the client still gets a terminal event.

**Where:** `open-sse/utils/stream.js`: `createSSEStream`

### D5. Translated streams re-emit a heartbeat

Anthropic `ping` events and upstream SSE comments produce no translated output, so the downstream client would see zero bytes during long thinking or tool prep and hit its own read timeout, while the gateway stall watchdog (reset by those same upstream bytes) stays quiet. The stream re-emits at most one heartbeat per interval: a native `event: ping` for Claude-format clients, an SSE comment (ignored per the SSE spec) for others.

**Where:** `open-sse/utils/stream.js`: `createSSEStream`; `tests/unit/translate-stream-heartbeat.test.js`

### D6. Ollama done:true is a real chunk; the [DONE] sentinel is not

`parseSSELine` turns `data: [DONE]` into `{ done: true }`, which must not be translated. An Ollama chunk also carries `done: true`, but it is the real final chunk with `finish_reason` and token counts, so it must go through translation. Ollama streams raw NDJSON (no `data:` prefix), so the flush path parses the leftover buffer with the same logic as the transform loop; otherwise an unterminated final line was lost.

**Where:** `open-sse/utils/stream.js`: `createSSEStream` (transform and flush); `open-sse/utils/streamHelpers.js`: `parseSSELine`; `tests/unit/ollama-stream-tail.test.js`

### D7. Pass the upstream format to response translators

A response translator can be reached directly (target equals its registered source) or as the second hop of a pivot, and on the terminal null chunk the pivot drops it. A translator that defers closing events until flush needs to know which case applies, so the stream passes the upstream source format. Absent means "unknown", do not defer.

**Where:** `open-sse/utils/stream.js`: `createSSEStream` (source format option)

### D8. Restore renamed colliding tool names in passthrough

The fingerprint pass renames a caller tool that collides with a built-in to an alias (read -> read_client). If passthrough does not restore it, the client receives a call to a tool it never declared and answers "Model tried to call unavailable tool 'read_client'" (#4986).

**Where:** `open-sse/utils/stream.js`: passthrough branch of `createSSEStream`

### D9. Streamed responses carry no-transform / no-buffer headers; re-streamed upstream headers are filtered

`Cache-Control` includes `no-transform` because Next's route-handler compression skips a response only for that (`Content-Encoding: identity` does not block it), and `X-Accel-Buffering` stops nginx-style proxies from buffering. When an upstream response is re-streamed, upstream headers are kept except those describing the upstream wire encoding (the body is already decoded), and the SSE guards are forced.

**Where:** `open-sse/utils/sseConstants.js`: `SSE_NO_COMPRESS_HEADERS`, `SSE_HEADERS_NO_BUFFER`, `sseResponseHeaders`

### D10. Sanitize chunks: per-stream streaming decoder, drop non-JSON lines, strip empty tool_calls

Each stream owns a `TextDecoder` used with `stream: true` so multi-byte characters split across chunks decode correctly. Non-JSON data lines (plain-text, HTML or rate-limit messages providers sometimes inject) are skipped silently so they do not break downstream JSON decoders. Empty `tool_calls: []` arrays (for example from CodeBuddy CN on every delta) are stripped because `@ai-sdk/openai-compatible` checks `delta.tool_calls != null`, and an empty array makes it emit a premature `reasoning-end` on every chunk.

**Where:** `open-sse/utils/stream.js`: `createSSEStream`

## Consequences

- Forwarding an upstream [DONE] plus the synthesized one makes strict clients fail; omitting it makes some clients hang until timeout and fail over; sending it to Gemini clients gives 400s.
- Faking a successful finish_reason on abort hides failures from clients and combo fallback.
- Doing finalization only in flush loses usage and log records for clients that hang up early.
- Without heartbeats or the completion watchdog, clients time out on long thinking or hang on stalled upstreams.
- Treating Ollama done:true as the sentinel drops finish_reason and usage.
