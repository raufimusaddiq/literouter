# ADR-0047: OpenCode (Zen / Go) provider handling

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

The OpenCode Zen free lane (`oc/*` models) and OpenCode Go are fronted by a gate that fingerprints the official CLI: it requires specific tools, a stable session, a request id and streaming, and it sheds load with 429s. The free lane is partly OpenRouter-backed, so its reasoning and tool-choice validation differs per model. The executor therefore mimics the real CLI closely and normalizes requests per lane (Chat Completions versus Responses).

## Decisions

### D1. Free-tier fingerprint tools are always required and canonicalised

Live probes show free-tier requests must include the lowercase quartet `bash`, `glob`, `grep`, `read`, even when an agent client (ZCode, Claude Code) already supplies non-empty tool arrays; skipping cloaking there triggers 403 FreeTierError. Callers may declare the same tools with different casing (`Read`), so those variants are renamed to the canonical name instead of duplicated (`Bash` + `bash` is rejected upstream as a duplicate; exactly one declaration per quartet member). Non-fingerprint tools are preserved verbatim, including ones differing only by case. The response side restores the caller's spelling so downstream clients recognise their own tool calls, which includes the openai to openai passthrough stream that has no format translation and must be handed the rename map explicitly (#4986 / #4994). The map is request-local (a WeakMap keyed by body) so no transport metadata goes on the wire. Responses use `auto` when the helper supplies tools; chat requests with no caller tools use `none` so the injected decoys cannot be selected.

**Where:** `open-sse/utils/opencodeFingerprint.js`: `concealFingerprintToolNames`, `recordRenamedToolNames`, `applyFingerprintTools`; `open-sse/executors/opencode.js`: `execute`; `tests/unit/opencode-fingerprint-passthrough-restore.test.js`

### D2. Requests are always streamed upstream

Zen rejects non-streaming requests on free models with 403 FreeTierError, so the executor always sets `stream = true` and lets the handler layer aggregate for non-stream clients.

**Where:** `open-sse/executors/opencode.js`: `transformRequest`

### D3. Free-lane overload 429s are retried with backoff; quota 429s are not

The free lane sheds load with 429 "The inference service is overloaded. Please try again later." even after a request passes the TLS gate, and the OpenCode CLI retries it. The executor inspects a clone of the response body (a stream, so the original is never read) and retries transient overloads, then hands back every other response untouched. Up to 8 attempts with 800 ms base and 4000 ms cap (800+1600+2400+3200+4000x3, about 20 s), because live bursts last about 20 s. Classification: "overload" (matches `/overloaded/i`), "session" (any other 429 such as FreeUsageLimitError, or 403) and none. The classifier must key on "overloaded" because the free-tier quota 429 also says "try again later" and is not transient; it is delivered without delay.

**Where:** `open-sse/executors/opencode.js`: `classifyRejection`, `OPENCODE_OVERLOAD_*`, `execute`; `tests/unit/opencode-overload-retry.test.js`

### D4. One stable canonical session per downstream identity; spent sessions are dropped

Upstream free-tier quota is accounted per session, and a fresh `x-opencode-session` on every request burns it, surfacing as 429 FreeUsageLimitError with growing reset-after delays. The real CLI reuses one long-lived session per conversation, so the executor keeps one stable session per downstream identity, evicted after `MEMORY_CONFIG.sessionTtlMs`. `x-opencode-request` is derived deterministically from the session plus the last user message so retries share the id. Because sessions are memoized and never refreshed on failure, a spent or flagged session would be reused until restart (#5559), so a non-transient rejection drops the rejected id (matched by value, not identity key, so a concurrent replacement survives); overload retries keep the same session. A client-supplied native session is never replaced.

**Where:** `open-sse/executors/opencode.js`: `stableOpencodeSessions`, `deriveRequestId`, `forgetOpencodeSession`; `tests/unit/opencode-overload-retry.test.js`

### D5. Reasoning and tool-choice are normalized per lane

The Chat Completions lane validates `reasoning_effort` against the plain OpenAI enum (none|minimal|low|medium|high|xhigh|max) and answers 400 "Invalid option" otherwise, including `auto`, which is how adaptive thinking (Claude Code's `thinking:{type:"adaptive"}`) arrives; the field is omitted so upstream picks its default. The Responses path likewise rejects "unknown variant `auto`". For Responses models only those confirmed auto-only (`forceAutoToolChoiceModels`, e.g. muse-spark-1.3-contributor-free, which 400s on anything but `"auto"`) have named/required/none demoted to `auto`; the allowlist grows only with evidence. `oc/deepseek-v4.1-flash-free` serves exactly low|high|max, so the generic deepseek-v4 declarations (medium/xhigh) and the low/medium to high collapse must not apply. `glm-5.3-flash-free` rejects the zai `thinking` object (400 unknown field) while accepting `reasoning_effort`. `oc/mimo-v2.6-flash-free` is OpenRouter-backed: it honours "none" by dropping thinking and streams `reasoning` + `reasoning_details[]` rather than `reasoning_content`.

**Where:** `open-sse/executors/opencode.js`: `normalizeOpencodeReasoning`, `transformRequest`; `tests/unit/opencode-free-deepseek-effort.test.js`; `tests/unit/opencode-free-glm-thinking-format.test.js`; `tests/unit/opencode-free-mimo-reasoning.test.js`; `tests/unit/opencode-free-tool-choice.test.js`

### D6. Reasoning-bearing models need echo or alias handling in the pipeline

Zen reasoning models reject multi-turn history whose assistant messages carry no `reasoning_content` (400 `missing_required_parameter`), and the response pipeline strips the field before it reaches the client, so the echo can never come from the client; a placeholder is injected. The free lane's MiMo route streams thinking as `reasoning`, and `stream.js` lifts the alias into `reasoning_content` for OpenAI-shaped clients (a no-op for other models). SenseNova Intl has the same alias behaviour.

**Where:** `open-sse/providers/registry/opencode.js`; `open-sse/providers/registry/sensenova-intl.js`

### D7. OpenCode Go routes some models only through Responses or Chat

Luna is exposed only through the Responses API, so both the target format and supported transport are pinned so chat-format clients (including combos) are translated instead of being sent to `/chat/completions`; the responses-only entry forces `chatCore` past the sourceFormat-matched transports into translation. A model dynamically advertised by `/models` whose Responses endpoint returns HTTP 500 is instead routed through Chat and translated. `/messages` uses adaptive thinking and `output_config.effort` for DeepSeek.

**Where:** `open-sse/providers/registry/opencode-go.js`

### D8. Region errors link to the workspace opt-in

OpenCode reports region blocks as `RegionError`, so the model row offers its workspace opt-in link.

**Where:** `src/app/(dashboard)/dashboard/providers/[id]/ModelRow.js`: `regionOptInUrl`

## Consequences

- Omitting the fingerprint tools, or not streaming, yields 403 FreeTierError.
- Minting a session per request burns the free quota; never dropping a spent session pins every later request to the same failure until restart.
- Retrying all 429s delays genuine quota errors; retrying none surfaces transient overloads to clients.
- Forwarding `auto` reasoning effort, or the `thinking` object to GLM free, produces 400s.
- Not restoring caller tool-name casing in the passthrough stream makes clients reject calls to tools they do not have.
