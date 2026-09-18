# Streaming sentinel duplication

PRD section 20 requires streaming event semantics to remain valid. Probing the
passthrough stream with a conformant upstream (one that sends its own
`data: [DONE]`) produced **two** sentinel frames. Strict SSE clients can treat a
second terminator as a protocol error, and the duplicate was invisible to every
existing test because none asserted the sentinel count.

## Root cause

`open-sse/utils/stream.js`, passthrough branch. The handler only parsed a line
when it did not look like the sentinel:

```js
if (trimmed.startsWith("data:") && trimmed.slice(5).trim() !== "[DONE]") {
  ... // parse and re-emit normalized JSON
}
```

When the line *was* the sentinel, `output` stayed `undefined` and control fell
through to the generic emit path, which reconstructed the raw line verbatim:

```js
output = line + "\n";
```

So the upstream sentinel was forwarded as-is, and the stream-end synthesis added
a second one. A first attempt that only marked `streamDoneSent = true` at the
synthesis site did not help: the forwarded copy came from the other branch.

## Fix

Skip the sentinel line in the passthrough loop, and let stream end synthesize
the single terminator:

```js
if (trimmed === "data: [DONE]" || trimmed === "data:[DONE]") continue;
```

The synthesis guard (`!streamDoneSent`) still emits exactly one terminator when
the upstream sends none.

## Evidence

Live staging, `POST /v1/chat/completions` with `stream: true`, sentinel count
per response:

| Build | Count |
| --- | --- |
| Before | 2, 2, 2 (three runs) |
| After | 1, 1, 1 |

Regression tests: `tests/unit/literouter-passthrough-done.test.js` asserts one
sentinel when the upstream sends its own and one when it sends none;
`tests/unit/literouter-stream-done-once.test.js` asserts every write site marks
the sentinel as sent. The first test was confirmed to fail against the unfixed
source, so it is not a silent no-op.

Streaming content, the Responses stream, the Messages stream, and non-streaming
requests were all re-checked after the change and are unaffected.
