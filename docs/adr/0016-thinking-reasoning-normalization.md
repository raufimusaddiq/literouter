# ADR-0016: Thinking and reasoning normalization

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Every provider family expresses "thinking" differently: Anthropic adaptive/budget shapes, z.ai `thinking` objects, OpenAI `reasoning_effort`, Gemini `thinkingLevel`, DeepSeek-shaped objects, and vendor aliases for the returned text (`reasoning`, `reasoning_details[]`, `reasoning_content`). LiteRouter captures the client's intent, translates it per target in `thinkingUnified.js`, and consults per-provider/model tables in `capabilities.js` and `thinkingLevels.js`. Most entries in those tables exist because a live probe or an upstream doc showed a specific 400. These decisions keep that knowledge.

## Decisions

### D1. Capability rows encode live-probed upstream behaviour; the declared shape is authoritative

Several models are served by backends whose strict validators differ from the vendor's own API, so per-provider overrides win over global patterns:

- OpenCode serves glm-5.3-flash (free id on `/inference/v1` as provider `opencode`, and `/zen/v1` as `opencode-zen`; paid id on `opencode-go`) from its own inference service. It answers 400 `unknown field "thinking"` to the z.ai `thinking` object and accepts `reasoning_effort` (none..max). The zai shape stays correct for z.ai's own lines (`glm`, `glm-cn`), and codebuddy-cn already resolves glm-5.3-flash to the openai shape. Probed live 2026-10-18.
- OpenCode Free (`oc`) MiMo is OpenRouter-backed and takes the plain OpenAI effort enum verbatim (none|minimal|low|medium|high|xhigh|max all 200, anything else 400 "Invalid option"; "none" really drops thinking). The global `*mimo*v2.6*` pattern describes Xiaomi's own API and is ignored by this lane (`thinking.type:disabled` still streamed reasoning). Its levels entry must sit ahead of the generic `*mimo*v2.6*` one, whose [none..xhigh] set would make `max` unreachable. That override short-circuits the catalog overlay, so models.dev's free-lane limits (200000/32000) must be applied by hand if a probe ever pins the real window.
- mimo-v2.5-pro on opencode-go rejects effort `max`; v2.5 accepts it.
- NVIDIA NIM is OpenAI-compatible and rejects MiniMax/GLM-native `thinking`, so its reasoning models are forced to the openai `reasoning_effort` format.
- `deepseek-v4.1-flash-free` rejects prompts above about 330k tokens (#5097), so the published context window is capped at 330000 to make clients such as VS Code Copilot compact correctly.
- Haiku 5.5 is adaptive-only like the rest of 5.x; the `*claude*haiku-5*` pattern still describes the extended-thinking shape and would 400 ("thinking.type.enabled" is not supported).
- Opus/Sonnet 4.6 lack `xhigh` (Anthropic and Kiro docs); gpt-6.1-sol rejects `none` and `minimal`; DeepSeek v4.* (Alibaba MaaS) accepts low..max via `output_config.effort` and 400s on `none` over the anthropic route (kept in the picker to mean disable); codebuddy-cn publishes `reasoning.supportedEfforts` per model and silently clamps values outside it, so the declared set is authoritative for the picker; OpenAI documents `max` for GPT-5.6 and GPT-6 (#5186), so OpenAI-compatible nodes carry it too instead of clamping to `xhigh`.
- Kenari's synced catalog is authoritative server-side, with `none` only if its toggle is on.
- Model-name pattern overrides are globs where the first match wins, more precise than the format default.

**Where:** `open-sse/providers/capabilities.js`: `MODEL_CAPABILITIES`, `PROVIDER_CAPABILITIES`, pattern table; `open-sse/providers/thinkingLevels.js`: `getThinkingLevels`; `tests/unit/openai-compatible-gpt6-max-effort.test.js`

### D2. GLM-5.3 cannot disable thinking; effort is supported only from GLM-5.2

z.ai docs state that GLM-5.3 and GLM-5.3-FLASH no longer support disabling thinking (an error occurs if `thinking.type` is set to disabled). With `thinkingCanDisable` left true, `applyThinking` emitted `enable_thinking:false` whenever a turn asked for no reasoning, and z.ai answered 400 code 1210 "Invalid API parameter", intermittently because only some turns ask (#4409, from v0.5.91, via `api.z.ai/api/anthropic/v1/messages`). It is set false on the `*glm-5.3*` pattern so both glm-5.3 and glm-5.3-flash get it while the pattern keeps `thinkingEffortSupported:true`. Older GLM (5.1 and below) still accept `disabled` and must not change. `reasoning_effort` is read by z.ai only from GLM-5.2 onward, so it is gated per exact version rather than the `*glm-5*` catch-all, and skipped on unsupported models. GLM-5.3 accepts exactly low|high|max; GLM-5.2 maps low/medium to high and xhigh to max server-side, so a three-value mapping fits both. z.ai ignores `thinking.disabled`; use `enable_thinking:false` to turn off.

**Where:** `open-sse/providers/capabilities.js`: `glm-5.3-flash` entry and `*glm-5.3*` pattern; `open-sse/translator/concerns/thinkingUnified.js`: `applyThinking` (zai branch); `tests/unit/glm53-thinking-cannot-disable.test.js`

### D3. Capture thinking intent before translation, including "wants the text"

Format translation strips thinking fields, so `captureThinking` records intent from the original body first. For OpenAI-shaped clients it also records whether they want the thinking text itself: Claude returns text only when `thinking.display` is "summarized", a field OpenAI has no equivalent for, and otherwise the redact-thinking beta makes every block come back signature-only. For the Responses API `reasoning.summary` is the explicit request; Chat Completions has no summary knob, so setting `reasoning_effort` is treated as asking for reasoning (clients such as opencode, DeepSeek Harness and Cherry Studio otherwise saw empty `reasoning_content`). Claude-format clients set `display` themselves and keep what they asked for. OpenAI chat/Responses extraction checks effort first (zai sends both a thinking object and `reasoning.effort`).

**Where:** `open-sse/translator/concerns/thinkingUnified.js`: `extractThinking`, `captureThinking`, `applyThinking`; `tests/translator/openai-thinking-display.test.js`

### D4. Per-target emit rules in applyThinking

- Anthropic: models that can disable thinking need an explicit `thinking:{type:"adaptive"}` together with `output_config`; `output_config` alone leaves thinking OFF on Opus 4.6/4.7/4.8 and Sonnet 4.6 (and Anthropic-compatible shims such as Copilot default off even on Sonnet 5). Permanently adaptive models (Fable 5.1) accept effort directly. `xhigh` is clamped when the model does not advertise it. `prepareClaudeRequest` must reconcile `max_tokens` with `thinking.budget_tokens`, since `applyThinking` runs after `adjustMaxTokens`, and a "max" effort budget (128000) can exceed the clamped `max_tokens` and trip Anthropic's `max_tokens > budget_tokens` 400.
- Gemini: effort maps to `thinkingLevel` (minimal|low|medium|high); Gemini 3 cannot fully disable thinking, so none/off map to minimal. `thinkingConfig` nests under `generationConfig`, and gemini-cli/antigravity wrap the request in `{ request: { generationConfig } }`, so the envelope's one is targeted when present.
- Muse (Meta) strict Responses API rejects top-level `reasoning_effort` and needs `reasoning: { effort, summary }`.
- DeepSeek's own API collapses low/medium to high and xhigh/max to max, so the wire stays on {high,max}, but declared levels win where they disagree (zen's free deepseek-v4.1-flash publishes low|high|max and forwards verbatim). Where declared levels exclude `max` (mimo v2.5-pro/v2.6 on opencode-go), clamp to high.
- Explicit `budget_tokens` is kept (captured before translation and `stripAll`) only for dynamic compat nodes (vLLM/SGLang validate it; first-party DeepSeek ignores it).
- TokenRouter's enum is low/medium/high/xhigh/max, rejects none/auto with 400 and supports max natively; "none" omits the field.
- `providerThinking` mode on/off must never leak into `reasoning_effort` (previously "on"/"off" shipped upstream).
- Mid-conversation, thinking config follows the last message role: OpenAI tool results continue a user turn and keep its thinking intent.

**Where:** `open-sse/translator/concerns/thinkingUnified.js`: `applyThinking`; `open-sse/translator/concerns/thinking.js`; `open-sse/services/provider.js`; `tests/translator/thinking-unified.test.js`; `tests/translator/bugs-toClaude-context.test.js`; `tests/unit/provider-thinking-on-off-override.test.js`

### D5. Normalize reasoning text from vendor aliases into reasoning_content

Upstreams stream thinking as `reasoning_content` (GLM, Qwen, DeepSeek, Kimi, Step, Hunyuan), `reasoning` (some compat layers, SenseNova, OpenRouter lanes such as OpenCode Free MiMo) or `reasoning_details[]` (MiniMax with reasoning_split). `liftReasoningAliases` lazily adds the canonical `reasoning_content` field, only ever adds (aliases stay for clients that read them) and never touches a delta already carrying it. This runs on every passthrough delta before the valuable-content check so reasoning-only chunks survive. Everything downstream (`reasoningDelta`, the SSE-to-JSON aggregator, usage tracking, non-stream-to-claude) reads `reasoning_content`; without the lift OpenAI-shaped clients see no thinking. The SSE-to-JSON parser counts the aliases as reasoning so the empty-content rescue can keep an alias lane's thinking, and strips `reasoning_content` only when content is non-empty (it was unconditional, which broke Qwen3.5 and Claude extended thinking when all tokens went to reasoning).

**Where:** `open-sse/translator/concerns/reasoning.js`: `liftReasoningAliases`, `extractReasoningText`; `open-sse/utils/stream.js`: `createSSEStream`; `open-sse/handlers/chatCore/sseToJsonHandler.js`: `parseSSEToOpenAIResponse`; `open-sse/translator/response/nonstream-to-claude.js`

### D6. Echo reasoning_content back where required, strip it where forbidden

Thinking-mode providers that require `reasoning_content` on assistant history (DeepSeek, Kimi, MiniMax; DeepSeek V4: "must be passed back to the API", #1543) get a non-empty placeholder from `injectReasoningContent` because OpenAI-format clients do not send it; the OpenCode executor (deepseek-v4-flash-free) must run the injector too. opencode-go DeepSeek models on the claude-to-claude `/messages` passthrough get the same treatment as the official provider (#3332): keep existing thinking blocks, and inject an UNSIGNED placeholder on tool_use turns without one while thinking is enabled; the gate is model-based because opencode-go also serves minimax and qwen over `/messages`. Strict validators reject unknown assistant fields instead: Groq answers 400 and Mistral 422 (`extra_forbidden`) when clients such as Hermes echo reasoning, so `stripUnsupportedParams` drops it for those. NVIDIA NIM treats `reasoning` and `reasoning_content` as aliases for one field and reports a duplicate if both are sent, so the OpenAI canonical spelling is kept on history. Kimchi's upstream counts echoed scratch reasoning as input tokens (100k+ inputs, empty replies), so its executor strips real `reasoning_content` but keeps placeholder-shaped values (8 chars or fewer), since stripping the injector's single-space placeholder would re-trigger the missing-reasoning complaint.

**Where:** `open-sse/utils/reasoningContentInjector.js`: `injectReasoningContent`; `open-sse/translator/concerns/paramSupport.js`: `stripUnsupportedParams`; Kimchi executor `stripReasoningContent`; `tests/unit/kimchi-strip-reasoning.test.js`; `tests/unit/opencode-go-deepseek-thinking-injection.test.js`; `tests/unit/reasoningContentInjector.test.js`

### D7. Claude thinking blocks emit no literal think markers; reasoning closes on first text or tool call

claude-to-openai used to wrap a thinking block in literal `<think>`/`</think>` content chunks while the text went out in `reasoning_content`; the pair arrived empty and adjacent, so clients (opencode, DeepSeek Harness) showed a bare `<think></think>` above every answer (#3399, #4199). The Responses translators had relied on `</think>` as their only signal to close the reasoning item. With the marker gone, reasoning must be closed when the first message text or tool call arrives, which also fixes item ordering for every `reasoning_content` provider.

**Where:** `open-sse/translator/` claude-to-openai and Responses response translators; `tests/unit/claude-thinking-stream-boundaries.test.js`

### D8. Normalize newer Cowork/Claude Code beta request shapes

chatCore normalizes newer Cowork/Claude Code beta shapes (adaptive thinking, mid-conversation system messages) that the API rejects, before dispatch.

**Where:** `open-sse/handlers/chatCore.js`

## Consequences

- Sending the z.ai `thinking` object to OpenCode lanes, `disabled` to GLM-5.3, `none` to DeepSeek/TokenRouter, or `max` to backends that reject it yields upstream 400s, often intermittently.
- Dropping the alias lift makes reasoning invisible to OpenAI-shaped clients and to usage accounting.
- Missing `thinking:{type:"adaptive"}` silently leaves thinking off on Opus/Sonnet 4.6+; a stale `max_tokens <= budget_tokens` 400s.
- Echoing or stripping reasoning_content on the wrong provider causes 400/422, duplicate-field errors or ballooning input tokens.
- Re-adding literal think markers shows empty think tags in clients and breaks Responses reasoning-item closure.
- Generic patterns placed above provider-specific levels entries make unsupported effort levels reachable (or supported ones unreachable).
