# ADR-0021: Gemini and Vertex request/response translation

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Gemini, Gemini CLI / Antigravity (Cloud Code envelopes) and Vertex AI all speak the Gemini wire format, but each is stricter than the OpenAI format LiteRouter pivots through. Their validators reject whole requests for schema keywords, duplicate call ids, tool-result keys or turn ordering that OpenAI-compatible upstreams accept. The decisions below are mostly workarounds for specific upstream 400 errors and are easy to regress by "simplifying" the translators.

## Decisions

### D1. Function call ids must be unique across the whole history, per occurrence

Gemini validates `functionCall` id uniqueness across the entire conversation and answers 400 INVALID_ARGUMENT when one repeats (#4532). An OpenAI `tool_call_id` is only unique within its own assistant turn, so a long agent session can replay the same id (e.g. `call_51859` at turn 14 and turn 22). `createToolCallIdUniquifier` rewrites ids per occurrence in document order (not memoized by id), so two different calls sharing an id get different emitted ids, and ids that were already unique pass through untouched. An id already ending in "-2" keeps counting instead of colliding again. Each `functionCall` calls `next()` once and the matching `functionResponse` reuses the returned id so the pair always agrees. The thought-signature cache lookup stays on the ORIGINAL id so cached signatures are still found.

**Where:** `open-sse/translator/request/openai-to-gemini.js`: `createToolCallIdUniquifier`, `openaiToGeminiBase`; `tests/unit/gemini-duplicate-tool-call-ids.test.js`

### D2. Tool results are queued per original id and carry their own name

Because ids can repeat across turns (#4273), tool results are queued per id (not stored in a plain id-to-content map, which keeps only the last and would answer an earlier turn with a later turn's output). Each functionCall consumes the oldest unconsumed result for its id, resolved on the ORIGINAL id while only the emitted id is uniquified. The function NAME also travels with the pair from this call, not from the conversation-wide `tcID2Name` map, which a later duplicate id would have overwritten. Gemini requires the response name to match the functionCall name, so the original tool name is resolved from the id for Cloud Code Claude envelopes too.

**Where:** `open-sse/translator/request/openai-to-gemini.js`: `toolResponses` queue, `emitId` handling, `wrapInCloudCodeEnvelopeForClaude`; `tests/unit/gemini-duplicate-tool-call-ids.test.js`

### D3. Gemini to OpenAI call ids: deterministic or tracked, never colliding

Gemini's `functionCall.id` is optional and Gemini has no native call id. In `gemini-to-openai`, a missing id gets a unique id minted per call, and each id-less `functionResponse` pairs with the oldest unanswered call of the same name, so two calls to one function in a turn do not collide. Elsewhere a deterministic id derived from the name (`call_<name>`) keeps the matching `functionResponse` mapped to the same `tool_call_id`, which providers require. The parts scan must complete before returning so parallel results all precede any co-located follow-up text or calls in the OpenAI message sequence.

**Where:** `open-sse/translator/request/gemini-to-openai.js`: `createCallIdTracker`, parts scan; `open-sse/translator/request/antigravity-to-openai.js`: functionCall id derivation

### D4. JSON Schema is aggressively sanitized for Gemini

The Gemini schema proto has no field for many JSON Schema keywords, and a single occurrence rejects the whole request ("Unknown name X: Cannot find field", #4283). `UNSUPPORTED_SCHEMA_CONSTRAINTS` strips array and tuple keywords, `default`/`examples`, `$schema`/`$defs`/`$ref`/`const`, and non-standard annotation keywords used by MCP tool schemas (`errorMessage`, `errorMessages`, `markdownDescription`, ...). `prefixItems` is first converted to `items`, since Gemini cannot express tuples and an array schema without `items` is rejected with "missing field". Every `type:"array"` schema gets a permissive `items` placeholder, and an `enum` forces `type:"string"` (otherwise 400). `items` is kept only on arrays and `properties`/`required` only on objects. The walk is schema-aware (`properties` is a name-to-schema map), so a parameter literally named "items", "properties" or "required" is never mistaken for a keyword; untyped schemas are left alone.

**Where:** `open-sse/translator/formats/gemini.js`: `UNSUPPORTED_SCHEMA_CONSTRAINTS`, `convertEnumValuesToStrings`, `convertPrefixItems`, `ensureArrayItems`, `enforceTypeConstraints`; `tests/unit/gemini-unknown-schema-fields.test.js`

### D5. Reserved `$ref` keys in functionResponse.response are renamed

Gemini and Cloud Code treat a `$ref` key inside `functionResponse.response` as a pointer to `functionResponse.parts` and reject the request ("The referenced name `#/$defs/...` in function_response.response does not match to a display_name in the function_response.parts"). Tool results carrying a JSON Schema or OpenAPI document (webfetch, read, MCP) hit this, so the key is renamed.

**Where:** `open-sse/translator/formats/gemini.js`: `GEMINI_RESERVED_RESPONSE_KEYS`, `sanitizeFunctionResponsePart`

### D6. Gemini 4 (Argon) quirks

Gemini 4 removed the sampling params, so forwarding them fails the request and generation config omits them. It also rejects a merged user turn whose last part is not a `functionResponse` (#4802), so `moveFunctionResponsesLast` reorders parts. `isGemini4Model` detects the family for these code paths. Vertex raw-key requests with an explicit project honor that project's location (e.g. Argon on global).

**Where:** `open-sse/providers/capabilities.js`: `isGemini4Model`; `open-sse/translator/request/openai-to-gemini.js`: `allowSampling`; `open-sse/translator/formats/gemini.js`: `moveFunctionResponsesLast`

### D7. Cloud Code envelopes keep VALIDATED function calling unless the client is explicit

Cloud Code envelopes (gemini-cli / antigravity) default to VALIDATED function calling. A client's plain "auto" carries no extra intent, so the default stays; none, required and named-function choices are explicit and honoured.

**Where:** `open-sse/translator/request/openai-to-gemini.js`: `explicitToolConfig`

### D8. Vertex needs project-scoped paths, id stripping and its own signatures

Partner models require the project id in the path regardless of auth method, and SA JSON / ADC / pre-set accessToken auth must also use the project-scoped path to avoid RESOURCE_PROJECT_INVALID. Raw API keys without a project keep the projectless endpoint (existing connections); the project id for a raw key is resolved by sending a dummy request and parsing `projects/{id}` from the 404 message. `?alt=sse` is required for proper SSE streaming, like every other Gemini executor. `postProcessForVertex` replaces synthetic thoughtSignatures with the Vertex-native one and strips `id` from `functionCall` and `functionResponse`, which Vertex rejects.

**Where:** `open-sse/executors/vertex.js`: `buildUrl`, `resolveProjectId`; `open-sse/translator/request/openai-to-vertex.js`: `postProcessForVertex`

### D9. Cloud Code project ids are fetched, and hosts are split by purpose

`projectId.js` fetches and caches the real project id bound to the authenticated account via Cloud Code instead of generating random ids (e.g. "useful-spark-a1b2c"), which significantly reduces the risk of being flagged by Google's anti-abuse systems. For Antigravity, discovery (`loadCodeAssist`) uses the PROD host because the daily host rejects auth/onboarding calls, while chat transport uses the daily host to bypass prod 429.

**Where:** `open-sse/services/projectId.js`; `tests/unit/gemini-36-integration.test.js`

### D10. Gemini-family streams do not emit [DONE]; thought-only parts are not content

Gemini-family clients reject the OpenAI `[DONE]` sentinel; the stream just closes. The `/v1beta/models` route transforms OpenAI SSE to Gemini SSE on the fly, since `@google/genai` always uses `:streamGenerateContent?alt=sse`; streaming is decided by the URL action suffix (`:streamGenerateContent` is SSE, `:generateContent` is plain JSON). Responses that Node fetch has already decoded must not forward upstream compression headers, or clients decompress plain bytes again. In the response translator, parts marked `thought: true` (with or without a `thoughtSignature`) are never surfaced as normal assistant content, and Gemini bookkeeping is kept apart from the shared `state.toolCalls`, which the downstream OpenAI to Claude translator uses for block metadata (pre-populating it makes Anthropic tool deltas lose their index).

**Where:** `open-sse/providers/registry/gemini.js`, `open-sse/providers/registry/antigravity.js`, `open-sse/providers/registry/vertex.js`: `[DONE]` quirk; `src/app/api/v1beta/models/[...path]/route.js`: `POST`; `open-sse/translator/response/gemini-to-openai.js`: `geminiToOpenAIResponse`

## Consequences

- Dropping id uniquification or the per-id result queue brings back 400 INVALID_ARGUMENT in long agent sessions and answers earlier turns with later output.
- Passing tool schemas through unsanitized (`$ref`, `default`, annotation keywords, tuples, array without `items`) makes Gemini and Antigravity reject entire requests for one tool.
- Sending sampling params, or leaving a non-functionResponse part last, breaks Gemini 4.
- Missing project-scoped Vertex paths, or leaving `id` on Vertex calls, produces RESOURCE_PROJECT_INVALID or rejections.
- Emitting `[DONE]` or surfacing thought parts as text breaks Gemini-format and OpenAI-compatible clients respectively.
