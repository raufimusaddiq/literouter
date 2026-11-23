# ADR-0043: GitHub Copilot routing

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

GitHub Copilot exposes several endpoints with different model coverage: `/chat/completions` (gpt, gemini, grok), `/responses` (OpenAI gpt/codex only) and an Anthropic-native `/v1/messages` shim for Claude. The executor in `open-sse/executors/github.js` must pick the right endpoint per model, and Copilot's live model catalog (`services/copilotModels.js`) regularly lists new models ahead of the static registry in `open-sse/providers/registry/github.js`.

## Decisions

### D1. Claude models go to /v1/messages, chosen by model name at request time

Claude models are routed to Copilot's Anthropic-native `/v1/messages` shim, the only Copilot endpoint that surfaces prompt-cache token counts. gpt, gemini and grok stay on `/chat/completions` (or `/responses`). The decision is a name-pattern check, not a registry `targetFormat` field: the live catalog exposes `claude-*` variants (for example `claude-opus-4.8`) before the static list catches up, so a static per-entry `targetFormat` would miss them and would double-translate listed models (chatCore pre-translating to Claude shape, then the executor translating again). Registry entries therefore stay plain.

**Where:** `open-sse/executors/github.js`: `execute`; `open-sse/providers/registry/github.js`

### D2. The executor translates OpenAI-shape to Anthropic itself

chatCore targets "openai" for github, so Claude requests arrive OpenAI-shaped and `executeWithMessagesEndpoint` translates to Anthropic-native; this is what makes `prepareClaudeRequest()` inject `cache_control`. Upstream `stream:true` is forced regardless of client preference (as in the responses path), because chatCore's non-streaming handler already buffers SSE into a single JSON reply. `_toolNameMap` is internal bookkeeping that chatCore normally strips and threads into response state to restore tool names; the executor must do the same, or Anthropic's strict schema rejects the extra field with a 400. A header that is a harmless no-op on `/chat/completions` and `/responses` is required by `/v1/messages`.

**Where:** `open-sse/executors/github.js`: `executeWithMessagesEndpoint`

### D3. Never escalate Gemini or Claude to /responses

Copilot's `/responses` endpoint serves only OpenAI (gpt/codex) models; Gemini and Claude reject with 400 "does not support Responses API" (`unsupported_api_for_model`). They must never be escalated to `/responses`, even when `/chat/completions` returned a "not supported" error for an unrelated reason, otherwise the caller sees a misleading 400 instead of the real `/chat/completions` error. `/responses` is used only for models explicitly known to need it (gpt codex models) that the endpoint actually serves. Fixes #1062.

**Where:** `open-sse/executors/github.js`: the escalation check in `execute`

### D4. Sanitize content and parameters for /chat/completions

That endpoint accepts only `text` and `image_url` content parts, so tool_use, tool_result and thinking content is serialized as text. Newer OpenAI models (gpt-5+, o1, o3, o4) require `max_completion_tokens` instead of `max_tokens`. A reasoning effort of "none" is stripped so models that do not support it do not 400.

**Where:** `open-sse/executors/github.js`: message sanitizer and request-parameter normalization

## Consequences

- Putting Claude on `/chat/completions` loses prompt-cache token counts; adding a static `targetFormat` double-translates and misses new catalog models.
- Escalating Gemini/Claude to `/responses` hides the real upstream error behind "does not support Responses API".
- Leaving `_toolNameMap` or tool-typed parts in the payload produces 400s from Anthropic or Copilot.
- Using `max_tokens` or `"none"` effort on newer models fails requests.
