# Request transform field map

PRD section 23 requires that, when a transform is enabled, the fields it changes
are documented. Native passthrough is not byte-for-byte forwarding once a
transform is explicitly enabled; this file states exactly what each one touches.

All three transforms are opt-in. With every transform disabled the router does
not reconstruct the body, and unknown fields survive (verified for
`forward_compatible_field` on the Responses ingress).

## RTK (`rtkEnabled`)

Compresses message *content* in place. It does not add fields.

| Body shape | Field changed |
| --- | --- |
| `messages[]` with `role: "tool"` | string `content`, or each `{type:"text"}` part's `text` |
| `messages[]` with a `tool_result` block | `block.content`, string form or each `{type:"text"}` part |
| `input[]` `{type:"function_call_output"}` | `output`, string form or each `{type:"input_text"}` part |
| `conversationState` (Kiro) | `history[]`/`currentMessage` → `userInputMessageContext.toolResults[].content[].text` |

Blocks with `is_error === true` (Claude) or `status === "error"` (Kiro) are
skipped, so error traces survive. Nothing is added or removed at the top level;
only text already present is rewritten, and only when it is between
`MIN_COMPRESS_SIZE` and `RAW_CAP` bytes.

## Caveman (`cavemanEnabled`, `cavemanLevel`)

Caveman and Ponytail share one injector (`open-sse/rtk/systemInject.js`) and
differ only in the prompt text they append. The injector dispatches on the wire
shape and is idempotent — re-running it for the same prompt is a no-op, which
matters because retries re-enter the same code path.

| Detected shape | Field changed |
| --- | --- |
| OpenAI Responses with string `instructions` | `instructions` (prompt appended, `\n\n` separator) |
| Chat body with `messages[]` | the first `system`/`developer` message's `content`; if none exists, a `{role: "system", content: prompt}` message is unshifted at index 0 |
| Responses with `input[]` | the first `system`/`developer` input item's `content`; otherwise a `message` item with an `input_text` block is unshifted |
| Responses with string `input` | left untouched (deliberate) |
| Claude | `system`, as a string append or an inserted text block placed before the last `cache_control` block when one exists |
| Gemini / Gemini CLI / Vertex / Antigravity | `systemInstruction` (or `system_instruction` when that key already exists), nested under `request` when the body is wrapped |
| Kiro | the first user turn's `content` inside `conversationState`. Top-level `systemPrompt` is deliberately never written — kiro.dev rejects it with `400 REQUEST_BODY_INVALID` |

## Ponytail (`ponytailEnabled`, `ponytailLevel`)

Identical field behaviour to Caveman; only the appended prompt differs.

## Ordering

When more than one transform is enabled they compose: RTK rewrites existing
content, then the shared injector appends the Caveman prompt, then the Ponytail
prompt. Because injection is idempotent per prompt, enabling both appends both
instructions once each rather than alternating.

## Fields never touched by transforms

`model`, `stream`, `tools`, `tool_choice`, `temperature`, `top_p`, `max_tokens`,
`metadata`, and any unrecognised top-level key. Routing and authentication
fields are handled before the transforms run.

## Tests

`tests/unit/literouter-token-savers.test.js` asserts each transform mutates the
body at every level and that Caveman and Ponytail compose without error.
