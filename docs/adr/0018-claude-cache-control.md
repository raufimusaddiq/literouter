# ADR-0018: Claude prompt cache control and breakpoints

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Requests to Claude-format upstreams are re-anchored so Anthropic's prompt cache hits reliably. The anchoring pins the last system block and last tool at 1h, and the last assistant turn at 5m. The Messages API allows at most 4 `cache_control` markers per request, rejects some marker placements outright, and needs the cached prefix to stay byte-stable across turns. The logic lives in `open-sse/translator/formats/claude.js`. It runs on the translated path (`prepareClaudeRequest`) and on the Claude passthrough path (`anchorClaudeCache`). chatCore calls it after the token savers have run.

## Decisions

### D1. Re-anchoring runs last, after everything that can reshape the body

`anchorClaudeCache` must run after normalization, tool dedupe and every token saver, otherwise the anchor drifts off the tail. The client's own markers point at pre-normalization offsets, so they are dropped and replaced: last tool and last system block at 1h, last assistant turn at 5m. Any bare-object content block is wrapped into a one-element array and its client-placed `cache_control` stripped, on every path, with or without the budget guard.

**Where:** `open-sse/translator/formats/claude.js`: `anchorClaudeCache`, `normalizeMessageContent`; `open-sse/handlers/chatCore.js`: `handleChatCoreInner` (anchor call)

### D2. A tool with `defer_loading` must never carry `cache_control`; anchor on the last cacheable tool

Anthropic rejects a tool that carries both `defer_loading: true` and `cache_control` ("Tools defer_loading cannot use prompt caching", #3567). MCP clients such as Claude Code put deferred tools at the tail, which is exactly where the cache anchor lands, so the request used to 400 before combo fallback could try the next hop. The anchor goes on the last tool that can be cached (`lastCacheableToolIndex`) instead of dropping caching. Invalid defer_loading plus cache_control pairs are stripped first, regardless of budget, because the over-budget early return used to forward them untouched.

**Where:** `open-sse/translator/formats/claude.js`: `lastCacheableToolIndex`, `anchorClaudeCache`; `tests/unit/defer-loading-cache-control.test.js`

### D3. Four-marker budget: head anchors are applied first and always held

The Messages API allows at most 4 cache markers across system, tools and messages. Head anchors (last system block, last cacheable tool) are applied before any budget guard, because the 1h TTL on system and tools is the whole point of re-anchoring. Skipping it because the client spent its budget would silently downgrade a hit to the 5m default and halve cache lifetime. With the head anchors pinned, at most 2 slots remain, and the guard runs after them. At 4 or more markers every remaining marker is already a valid breakpoint, so re-anchoring the tail could only exceed 4, and the code trims instead. Trimming holds the head anchors and gives the rest of the slots to the tail-most other markers in document order. A plain "keep the last 4 in document order" rule would drop the head anchors first, since they lead document order.

**Where:** `open-sse/translator/formats/claude.js`: `countCacheControlBlocks`, `capCacheControlBlocks`, `anchorClaudeCache`; `tests/unit/claude-cache-budget-single-object.test.js`

### D4. Tail breakpoints: prefer the last assistant turn, and cache final tool results when budget allows

The tail marker prefers the last assistant turn, because it ends a completed exchange and the prefix up to it stays byte-stable across following requests. On the first turn there is no assistant yet, so the final message is anchored, which caches the opening prompt instead of paying for it twice. In an agent tool loop a request ends with the results of the last assistant turn's tool calls, after that turn's breakpoint. Those results are billed at full input price, and the next request (which appends to them) only then writes them into the cache. When budget has room, `markFinalToolResults` puts a 5m breakpoint on that final user turn so they are cached now and the next request reads them.

**Where:** `open-sse/translator/formats/claude.js`: `anchorClaudeCache`, `markFinalToolResults`; `tests/unit/claude-cache-final-tool-results.test.js`

### D5. Mid-conversation system messages are folded in place, never hoisted into `body.system`

Hoisting them would insert volatile content (token counters, reminders) ahead of the whole conversation and invalidate the prefix cache on every request. Folding them into the neighbouring turn keeps the cached prefix stable. Text-only content arrays stay arrays, so per-block `cache_control` survives.

**Where:** `open-sse/translator/formats/claude.js`: `normalizeClaudePassthrough` (system fold step); `tests/unit/translator-helpers-edge.test.js`; `tests/unit/translator-request-normalization.test.js`

### D6. `thinking` and `redacted_thinking` blocks never get `cache_control`

Claude does not accept `cache_control` on thinking blocks, so `markLastCacheableBlock` skips them and picks an earlier eligible block. The OpenAI to Claude request translator strips `cache_control` when it builds a thinking block for the same reason.

**Where:** `open-sse/translator/formats/claude.js`: `markLastCacheableBlock`, `prepareClaudeRequest` (cache marking)

## Consequences

- Anchoring before a saver or normalization step leaves the marker on the wrong block, and every request pays a prefix rewrite.
- Putting `cache_control` on a deferred tool returns 400 for any Claude Code or MCP request, and the combo then silently moves on.
- Honouring an over-budget client marker set can send more than 4 markers (400), and skipping head anchors downgrades 1h caches to 5m.
- Hoisting system reminders into `body.system` invalidates the cache on every turn.
- Marking thinking blocks makes Anthropic reject the whole request.
