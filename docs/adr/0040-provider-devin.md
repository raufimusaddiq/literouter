# ADR-0040: Devin CLI and ACP executors

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

The Devin provider has no HTTP API: the executor spawns the local `devin` CLI as a subprocess and talks to it over ACP (a JSON-RPC protocol on stdio), then converts its notifications into OpenAI streaming output. The provider is `noAuth`, relying on credentials that `devin auth login` stored locally. The agent can run shell commands and edit the filesystem, so several decisions are about safety, and several others track the protocol of devin 3000.2.x.

## Decisions

### D1. Local credentials only; never inject an API key

The subprocess inherits the parent environment so devin resolves stored credentials (`~/.local/share/devin/credentials.toml`). `WINDSURF_API_KEY` must not be injected: the provider is noAuth, and a bogus or leaked key overrides stored credentials and makes devin return -32000 "invalid api key".

**Where:** `open-sse/executors/devin-cli.js`: spawn environment; `tests/unit/devin-cli-executor.test.js`

### D2. Unattended agent: auto-approve and agent type, local use only

Tool execution is auto-approved (`DEVIN_PERMISSION_MODE`, default bypass) because the default mode would hang the stream on the first shell/exec call waiting for a `session/request_permission` response the proxy never sends. Some tool kinds still prompt, so the executor also grants those permission requests once, as a headless proxy. The agent type defaults to the full agent with built-in fs/shell/search tools; `CLI_DEVIN_AGENT_TYPE=summarizer` gives a text-only mode. Either way the agent can run shell commands and modify the host filesystem, so the provider must only be exposed locally.

**Where:** `open-sse/executors/devin-cli.js`: spawn arguments and the permission-request handler

### D3. Client tools are bridged through a stdio MCP server

devin invokes only built-in and MCP tools, not OpenAI function schemas. `body.tools` are exposed as a stdio MCP server named `clientTools` (schemas via `DEVIN_MCP_TOOLS`, prior results via `DEVIN_MCP_RESULTS`), and devin only discovers MCP tools whose name carries the `mcp_` prefix, so the prefix is added and stripped when bridging back. When devin calls one, the executor emits an OpenAI tool_use and ends the turn; the client runs it and the next request re-spawns with full history and seeds the MCP server with those results so a re-call gets real data. ACP `tool_call` is upsert-by-id: the first event has the title (shape "Calling mcp_<name> from clientTools") and a later `tool_call_update` may carry only `rawInput`, so pending ids are tracked instead of requiring both fields on one notification. The bridge script is always rewritten so upgrades land without a restart.

**Where:** `open-sse/executors/devin-cli.js`: the MCP bridge setup and tool-call notification handling

### D4. Optional MCP servers via a throwaway config

Extra MCP servers (`DEVIN_MCP_SERVERS`, JSON in devin config format) plus the `clientTools` server are written to a throwaway `XDG_CONFIG_HOME` holding `devin/config.json`, because passing `mcpServers` to `session/new` alone does not spawn them (ACP mcp/connect is still unstable). It is cleaned up on finish. This replaces the user's global devin MCP config for that subprocess and keeps project `.devin/` out of play.

**Where:** `open-sse/executors/devin-cli.js`

### D5. Binary discovery and working directory

Because spawn uses `shell:false` on macOS/Linux, `process.env.PATH` can miss `~/.local/bin`, Homebrew, Scoop and similar when the server runs detached (tray, daemon, launchd) without a login shell, so known installer locations are probed before PATH. The subprocess and the session use the client workspace cwd (from the `<cwd>` environment context), preferring an absolute existing path, so built-in file tools create and delete relative paths in the user's project rather than `os.tmpdir()`.

**Where:** `open-sse/executors/devin-cli.js`: binary resolution, cwd selection, session creation

### D6. ACP protocol shape of devin 3000.2.x

`session/new` requires `mcpServers` as a sequence (omitting it returns -32602 "missing field mcpServers"), and `session/prompt` expects `prompt` as a sequence, not `content` (-32602 "missing field prompt"). `session/prompt` resolves with the final `stopReason` only after streaming completes, so streaming is handled via notifications. The notification payload is nested under `params.update.sessionUpdate` (older devin used a flat `params.type`), and errors arrive as `errorMessage`, not `message`/`error`. The fake devin in tests mirrors this validation, and the "Invalid params" error is the one the dashboard test button hit.

**Where:** `open-sse/executors/devin-cli.js`: session creation, prompt send, notification parsing; `tests/unit/devin-cli-executor.test.js`

## Consequences

- Injecting an API key makes devin reject its stored credentials with -32000.
- Without auto-approve, the first shell tool call hangs the stream indefinitely.
- Exposing this provider beyond localhost lets remote callers run shell commands on the host.
- Sending the old request shapes yields -32602 errors that only show up against real devin 3000.2.x.
- A tool name without the `mcp_` prefix is never discovered, so client tools silently disappear.
