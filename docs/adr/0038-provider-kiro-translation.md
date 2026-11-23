# ADR-0038: Kiro request translation

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Kiro (AWS CodeWhisperer `GenerateAssistantResponse`) is a binary EventStream upstream with strict request validation. Requests reach it through a direct `claude:kiro` route (no OpenAI pivot) and an `openai:kiro` translator, with a shared conversation canonicalizer in `open-sse/translator/concerns/kiroConversation.js`. The upstream rejects many shapes that other providers accept, so the translators repair, flatten or refuse locally. Response chunks arrive already converted to OpenAI shape by the Kiro executor.

## Decisions

### D1. Kiro-specific reconciliation instead of the generic helper

After session replay, Kiro uses its own source-aware canonicalization. The generic helper inserts OpenAI `role: tool` messages, which the direct Claude-to-Kiro translator cannot consume and which cannot repair partial parallel tool results. `canonicalizeKiroConversation()` enforces adjacent one-to-one tool use/result pairs, repairs partial parallel calls, and flattens compacted structured references that can no longer be represented safely. When the client omits `tools` (for example after compaction), structured tool content is flattened to text so Kiro's "tools required" 400 never fires and no phantom tool-calling capability is advertised; an orphan `tool_result` whose `tool_use_id` matches nothing is likewise handled.

**Where:** `open-sse/translator/index.js`; `open-sse/translator/concerns/kiroConversation.js`; `open-sse/translator/request/claude-to-kiro.js`; `tests/unit/openai-to-kiro.test.js`

### D2. Fail locally on a still-invalid body

If the canonicalizer's second-chance repair (flatten every structured tool turn to text, then re-validate) still leaves an invalid body, Kiro would answer 400 `{"message":"Improperly formed request.","reason":"REQUEST_BODY_INVALID"}`. The translators return a falsy value instead, and chatCore turns that into a 400 without spending an upstream call or a per-account cooldown. The validation taxonomy (`role:N | pair:N | id:N | spec:N | orphan:0 | current`) names the offending turn so the shape can be diagnosed from the log alone.

**Where:** `open-sse/translator/request/claude-to-kiro.js`, `open-sse/translator/request/openai-to-kiro.js`: the final validation step

### D3. The system prompt travels in the first user turn

The CodeWhisperer surface rejects a top-level `systemPrompt` with 400 REQUEST_BODY_INVALID, so the system text goes into the first user turn's content (`contentPrefix`); the top-level value is only a replay cache key. Tests assert against this real surface.

**Where:** `open-sse/translator/request/claude-to-kiro.js`, `open-sse/translator/request/openai-to-kiro.js`; `tests/translator/claude-kiro-direct.test.js`, `tests/unit/openai-to-kiro.test.js`

### D4. Never fall back to the shared default profile ARN for account-bound auth

API-key (headless), idc and external_idp credentials carry an account-specific or token-bound profile. The shared builder-id/social default ARN belongs to another account and triggers 403 "bearer token invalid". These auth types send only the ARN resolved for the connection, or an empty string so CodeWhisperer uses the token's own default profile. Only OAuth/social connections keep the shared placeholder fallback.

**Where:** `open-sse/translator/request/claude-to-kiro.js`, `open-sse/translator/request/openai-to-kiro.js`: profileArn selection

### D5. Thinking is mapped, not passed through

Kiro does not accept the generic top-level `thinking` field, so translators map thinking intent into KAS-compatible `systemPrompt` / `additionalModelRequestFields`, driven by provider capability. Detection covers the Anthropic-Beta header, Claude `thinking`, OpenAI `reasoning_effort`, AMP/Cursor magic tags and model name hints; supported models receive Kiro's schema-specific effort fields and legacy prompt tags remain only for models that need them. The synthetic `-thinking` suffix and `<thinking_mode>enabled</thinking_mode>` trigger are handled the same way. Kiro emits `reasoningContentEvent` for these, which becomes OpenAI `delta.reasoning_content` so downstream translators map it to Claude thinking blocks.

**Where:** `open-sse/translator/index.js`; `open-sse/translator/request/openai-to-kiro.js`: `buildKiroPayload`; `open-sse/translator/response/kiro-to-openai.js`

### D6. Synthetic -agentic suffix

`-agentic` is a 9router-only variant of the same upstream model that injects a chunked-write system prompt to keep large file writes under Kiro's 2-3 minute server timeout. The suffix is stripped before sending upstream, and a non-enumerable hint lets the executor route the upstream model id.

**Where:** `open-sse/translator/request/openai-to-kiro.js`: `buildKiroPayload`; `open-sse/translator/request/claude-to-kiro.js`

### D7. Message and content shape constraints

Kiro rejects user turns with empty `content`, so tool-result-only turns carry placeholder text. It must not read like an instruction: with "continue", models answered the word itself ("Nothing in progress to continue") and dropped their task. Kiro requires alternating user/assistant turns, so consecutive user messages are merged, and `userInputMessageContext` fields are combined so toolResults and images of the later message are not silently dropped. Tool results are text-only, so images a tool returned (screenshots) ride along as user images.

**Where:** `open-sse/translator/concerns/kiroConversation.js`; `open-sse/translator/request/openai-to-kiro.js`; `open-sse/translator/request/claude-to-kiro.js`

### D8. Tool names are sanitized and mapped back

Kiro tool specs only accept sanitized names (`mcp__a__b` becomes `mcp_a_b`). The request translator leaves a reverse map on the stream state so tool calls stream back under the client's own names in both response translators.

**Where:** `open-sse/translator/request/claude-to-kiro.js`, `open-sse/translator/request/openai-to-kiro.js`; `open-sse/translator/response/kiro-to-claude.js`, `kiro-to-openai.js`

### D9. kiro-to-claude consumes OpenAI-shaped chunks

`kiro-to-claude` does not receive raw AWS EventStream frames: `KiroExecutor.transformEventStreamToSSE()` already parses the binary stream into OpenAI `chat.completion.chunk` objects. The direct translator therefore re-implements OpenAI-chunk to Claude-SSE conversion (reasoning_content to thinking blocks, tool_calls to tool_use, usage to message_delta) so the direct route is self-contained and lossless. It is reached only when the source format is Claude and the target is Kiro.

**Where:** `open-sse/translator/response/kiro-to-claude.js`

## Consequences

- Using the generic tool-result helper or leaving unpaired tool turns yields REQUEST_BODY_INVALID 400s that burn account cooldowns.
- Sending `systemPrompt` or the shared default ARN gives 400 or 403 "bearer token invalid".
- Placeholder text such as "continue" derails the model's task.
- Un-sanitized or unmapped tool names break tool calling for MCP-style clients.
- Parsing raw EventStream in the translator double-parses chunks the executor already converted.
