# ADR-0046: Antigravity provider: request shaping, cloaking and sessions

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Antigravity (Google Cloud Code) serves Gemini and Claude models behind one API and fingerprints clients. The backend answers detail-free 429 RESOURCE_EXHAUSTED for requests that look like competing clients, bucketed incorrectly or malformed, even when quota is available. The executor therefore mimics the official IDE client closely (headers, tool naming, session ids, request types) and shapes Gemini-format bodies carefully. These decisions record what the upstream demonstrably rejects or flags.

## Decisions

### D1. Chat requests must not carry `requestType`

The official Antigravity client omits `requestType` entirely on the agent (chat) path. Sending `requestType: "agent"`, or leaking it from an upstream envelope through the `...body` spread, makes Google bucket the request and return a detail-free 429 RESOURCE_EXHAUSTED even with quota available. The executor deletes it for chat; `image_gen` and `search` buckets are unaffected and keep their own requestType. The same note applies to the request translator that wraps the Cloud Code envelope.

**Where:** `open-sse/executors/antigravity.js`: `transformRequest`; `open-sse/translator/request/openai-to-gemini.js`: `wrapInCloudCodeEnvelope`

### D2. Competing-client branding is rewritten out of system prompts

Competing-client branding (Zed's Claude prompt, OpenCode naming) makes the backend flag the request and answer 429 Quota Exhausted, so rewrite rules are applied to Antigravity system prompts. Claude Code's prepended identity line is stripped by the Claude-format translator, but OpenAI-format clients (proxies converting Claude Code to /v1/chat/completions) pass it through, and any system text containing it gets a fake 429, so it is rewritten too.

**Where:** `open-sse/config/appConstants.js`: rewrite rules; `open-sse/executors/antigravity.js`

### D3. Tools are cloaked with suffixes and decoy native tools

Client tools forwarded to Antigravity are renamed with an `_ide` suffix (an `_cc` suffix for the Claude provider) and Antigravity's native default tools are injected after them as decoys with neutral description and properties, using names that must match exactly what Antigravity sends in the real request log. Claude Code's own native tool names are kept as decoys and client tools matching them are skipped, not renamed. For GitHub Copilot, native names are not emitted twice; decoys appear once in the final declaration list. The tool name map (suffixed to original) restores names on the response.

**Where:** `open-sse/config/appConstants.js`; `open-sse/executors/antigravity.js`: tool cloaking

### D4. Project discovery stays on prod and uses minimal headers

`loadCodeAssist` and `onboardUser` stay on the PROD host because the daily host rejects these auth and onboarding calls; only chat uses the daily host (`transport.apiEndpoint`, set to bypass prod 429). The real IDE does not send `X-Goog-Api-Client` or `Client-Metadata` on those calls, and Google's backend fingerprints them and silently refuses to provision a `cloudaicompanionProject`.

**Where:** `open-sse/config/appConstants.js`; `open-sse/providers/registry/antigravity.js`

### D5. Thought signatures are per model family and backfilled

Gemini 3+ rejects `functionCall` parts without `thoughtSignature`. Clients such as Claude Code and IDEs do not persist signatures in history, so signatures are backfilled from cache or a default; in parallel function calls only the first call needs one and siblings stay unsigned. Thought-only parts are stripped while the signature on `functionCall` parts is kept. Gemini and Claude backends accept only their own signatures: a Claude signature replayed to Gemini fails with 400 "Corrupted thought signature." and vice versa, so the store records the family. Entries stored before families were recorded stay usable for any model.

**Where:** `open-sse/executors/antigravity.js`; `open-sse/services/thoughtSignatureStore.js`

### D6. Gemini body shaping rules

Fields Google generateContent rejects (Claude/OpenAI/Qwen thinking fields at body root, set by `thinkingUnified.js`) are removed. Image generation must use non-streaming generateContent, and `stream_options` is dropped for non-streaming calls because OpenAI clients may send it and Google rejects the combination before processing. `functionResponse` must be role "user" for Claude models. All tool declaration groups merge into a single `functionDeclarations` group because Gemini expects one.

**Where:** `open-sse/executors/antigravity.js`

### D7. Session id mimics the binary: stable per launch per connection

The Antigravity binary generates a session id once at startup (`rs() + Date.now()`). Because the gateway is long-running, it simulates per-launch behavior by storing a generated id in memory per connection: stable within a running instance (enabling prompt caching, using the binary's exact random logic) and changing on restart. Client session ids are extracted from the right place per format: the Antigravity envelope carries `request.sessionId` (requestId embeds the conversation uuid), and Claude Code sends the session both in a header and in `metadata.user_id`; the header survives translation to formats that drop metadata, such as the Responses API.

**Where:** `open-sse/utils/sessionManager.js`: session id generation and extraction

## Consequences

- Sending `requestType: "agent"` or competing-client branding produces unexplained 429s with quota available.
- Un-cloaked tool names or missing decoys increase ban and flag risk.
- Sending signatures across families, or omitting them for Gemini 3+, yields 400s.
- Adding client-metadata headers to project discovery silently prevents project provisioning.
- Regenerating session ids per request breaks prompt caching.
