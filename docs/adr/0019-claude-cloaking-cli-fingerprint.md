# ADR-0019: Claude CLI cloaking and version fingerprint

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

For OAuth-authenticated Claude (and some Claude-compatible providers such as agentrouter) LiteRouter presents itself as the official Claude Code CLI. Upstream gates on client identity: a `claude-cli/x.y.z` user agent, beta flags, tool names and a session id in `user_id`. Anthropic also refuses new models to CLIs below a minimum version (`claude_code_version_too_old`). This ADR records how the fingerprint is built and how cloaked tool names round-trip so the client never sees them.

## Decisions

### D1. Advertised CLI version is a pinned floor, raised by a bounded live lookup

`CLAUDE_CLI_VERSION` (currently 2.1.295) is only the floor. `utils/claudeCliVersion.js` resolves the latest `@anthropic-ai/claude-code` from npm to raise the advertised version, never lower it, and clamps a `CLAUDE_CLI_VERSION` env override up to the floor. The lookup is bounded: 3 s abort, 6 h success cache, 10 min failure backoff, one lookup in flight (a second caller joins it). It fails open (any error keeps the last known value) and never blocks chat: the refresh is fire-and-forget, so a request uses the version already known and an unreachable npm registry adds no latency. The lookup goes through `proxyAwareFetch` like every other outbound call. The module only ever raises to the floor so that a module loaded before `shared.js` still sends a real version rather than a placeholder.

**Where:** `open-sse/providers/shared.js`: `CLAUDE_CLI_VERSION`; `open-sse/utils/claudeCliVersion.js`: version resolution and refresh; `open-sse/utils/proxyFetch.js`: `proxyAwareFetch` refresh trigger; `tests/unit/claude-cli-version.test.js`

### D2. Client tools are renamed with CLAUDE_TOOL_SUFFIX, but typed server built-ins are exempt

Only providers flagged `cloakToolsOnOAuth`, and only with an OAuth token, get client tools renamed with `CLAUDE_TOOL_SUFFIX` (anti-ban). Tools that carry a `type` (built-in server tools such as `web_search_20250305`) need an exact reserved `name` and are never suffixed, or Claude rejects the request. Decoy names (real Claude Code tool names) are sent unsuffixed.

**Where:** `open-sse/translator/index.js`: `translateRequest` cloaking step; `open-sse/utils/claudeCloaking.js`: `cloakClaudeTools`

### D3. Forced tool_choice and tool_reference blocks must follow the rename

A forced `tool_choice` (`{ type: "tool", name }`) must point at the suffixed name, otherwise Claude answers "Tool '<name>' not found in provided tools". Deferred tool loading returns `tool_reference` blocks inside a `tool_result`; they resolve against `tools[]` by name and must follow the rename too, or Claude answers "Tool reference '<name>' not found in available tools". In both cases only names actually renamed are rewritten, never decoy or built-in names.

**Where:** `open-sse/utils/claudeCloaking.js`: `cloakClaudeTools`; `tests/unit/claude-cloaking.test.js`

### D4. Responses must be decloaked, including same-format streams

`translateRequest` suffixes tools even when source and target are both Claude, and the same-format fast path of `translateResponse` used to return chunks untouched, leaking names like `run_code_ide` to the client, which rejected the call as an unknown tool. Streamed events are therefore decloaked per event; a tool name appears only on the `content_block_start` of a `tool_use` block (argument deltas carry no name). Decloaking maps suffixed to original names via `toolNameMap` (cloaked to sanitized to original, e.g. `a_b_cc` to `a_b` to `a.b`). As a last resort, when the name is not in the map (map lost across a retry or reconnect), a trailing `CLAUDE_TOOL_SUFFIX` is stripped. Decoy names are never stripped so the client sees "tool unavailable" instead of a silent no-op.

**Where:** `open-sse/translator/index.js`: `translateResponse`; `open-sse/utils/claudeCloaking.js`: `decloakToolNames` and the streaming decloak function; `tests/translator/claude-claude-stream-decloak.test.js`

### D5. The tool name prefix is empty

`CLAUDE_OAUTH_TOOL_PREFIX` is an empty string because real Claude Code sends no tool name prefix. The earlier `proxy_` prefix was a detectable fingerprint difference.

**Where:** `open-sse/translator/request/openai-to-claude.js`: `CLAUDE_OAUTH_TOOL_PREFIX`

### D6. Session id and header set must be self-consistent

The `session_id` embedded in the cloaked `user_id` must match `X-Claude-Code-Session-Id`. Identity-gated providers (e.g. agentrouter) require the full Claude CLI fingerprint headers. Heavy-agent beta flags are sent only for opus/sonnet models; `redact-thinking` makes Anthropic return signature-only thinking blocks, which suits clients that never render thinking but blanks summaries a client requested with `thinking.display: "summarized"`. Nodes fronting Anthropic (rotating proxies, corporate gateways) need the same beta flags as the `claude` provider: without `context-management-2025-06-27` upstream returns HTTP 400 "context_management: Extra inputs are not permitted" and a combo silently falls through to the next model.

**Where:** `open-sse/translator/formats/claude.js`: cloaked `user_id` construction; `open-sse/providers/shared.js`: Claude CLI fingerprint headers and beta flags; `tests/unit/claude-header-forwarding.test.js`

### D7. Claude thinking signatures are validated by shape

Signatures (ported from CLIProxyAPI `internal/signature`) are accepted in two forms after stripping the `...#sig` cache prefix. E-form is single-layer base64 whose decoded first byte is `0x12`. R-form is double-layer base64 whose outer decoded first byte is `'E'` and inner first byte is `0x12`.

**Where:** `open-sse/utils/claudeSignature.js`

### D8. The Antigravity fingerprint is static

The Antigravity profile matches the official Antigravity IDE Desktop 2.11.0 captured on macOS arm64. It stays static even when the server runs on Linux, because the profile imitates the client, not the host.

**Where:** `open-sse/providers/shared.js`: Antigravity fingerprint constants

## Consequences

- Hardcoding a CLI version without the floor/raise logic breaks new models as soon as Anthropic bumps its minimum.
- A blocking or unbounded version lookup puts npm availability on the chat critical path.
- Renaming tools without also renaming `tool_choice` and `tool_reference`, or skipping response decloaking (especially claude to claude), makes Claude or the client reject calls as unknown tools.
- Suffixing typed built-in tools, or reintroducing a tool prefix, gets requests rejected or fingerprinted.
- A mismatched session id or missing beta flags on Anthropic-fronting nodes yields silent 400s and fallthrough.
