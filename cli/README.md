# LiteRouter - FREE AI Router & Token Saver

> The `literouter` package is not published to npm yet.

**Never stop coding. Save 20-40% tokens with RTK + auto-fallback to FREE & cheap AI models.**

**Connect All AI Code Tools (Claude Code, Cursor, Antigravity, Copilot, Codex, Gemini, OpenCode, Cline, OpenClaw...) to 40+ AI Providers & 100+ Models.**

[![npm](https://img.shields.io/npm/v/literouter.svg)](https://www.npmjs.com/package/literouter)
[![License](https://img.shields.io/github/license/raufimusaddiq/literouter.svg)](https://github.com/raufimusaddiq/literouter/blob/main/LICENSE)

[Repository](https://github.com/raufimusaddiq/literouter) • [Docker guide](https://github.com/raufimusaddiq/literouter/blob/main/README.md#docker)

---

## ⚡ Quick Start

**Option 1 — Bun (recommended for desktop):**

Requires [Bun](https://bun.sh) 1.4.4 or newer.

```bash
bun add -g literouter
literouter
```

Run once without installing: `bunx literouter`. Auto-start on boot needs a global install (`bun add -g`), not `bunx`. Upgrade with `bun add -g literouter@latest`. Coming from the old `9router` package? Run `npm rm -g 9router`, then `bun add -g literouter`. Config, database and environment are unchanged.

**Option 2 — Docker (server/VPS):**

See the [Docker guide](https://github.com/raufimusaddiq/literouter/blob/main/README.md#docker) for the image, volume and update instructions.

🎉 Dashboard opens at `http://localhost:20128`

**2. Connect a FREE provider (no signup needed):**

Dashboard → Providers → Connect **Kiro AI** (free Claude unlimited) or **OpenCode Free** (no auth) → Done!

**3. Use in your CLI tool:**

```
Claude Code/Codex/OpenClaw/Cursor/Cline Settings:
  Endpoint: http://localhost:20128/v1
  API Key:  [copy from dashboard]
  Model:    kr/claude-sonnet-4.5
```

That's it! Start coding with FREE AI models.

---

## 🚀 CLI Options

```bash
literouter                    # Start with default settings
literouter -p, --port 8080   # Custom port (default 20128)
literouter -H, --host <host>  # Host to bind (default 0.0.0.0)
literouter -n, --no-browser   # Don't open browser
literouter -l, --log          # Show server logs (default: hidden)
literouter -t, --tray         # Run in system tray mode (background)
literouter --skip-update      # Skip auto-update check
literouter -v, --version      # Show version
literouter -h, --help         # Show all options
```

### Stop the server

```bash
literouter stop            # Stop the running LiteRouter server
```

`literouter stop` stops only the server it started, recorded in `server.pid` in the data directory. It exits 0 when nothing is running and 1 if the server is still listening afterwards. An old Node `9router` server is stopped and replaced; one it cannot identify makes `literouter` exit 1 rather than start a second server on the same data directory.

**Dashboard**: `http://localhost:20128/dashboard`

### Configure a coding tool

```bash
literouter setup pi --url https://ai.example.com --models cx/gpt-5.5,glm/glm-5
literouter setup pi --all --dry-run     # print the result (key masked), write nothing
```

`literouter setup <tool>` writes the tool's config on this machine so it uses a LiteRouter server, local or remote. Options:

- `--url <url>`: the server (default `LITEROUTER_URL`, else `http://127.0.0.1:20128`); `/v1` is added when missing.
- `--key <key>`: a LiteRouter API key from the dashboard (default `LITEROUTER_API_KEY`, else a hidden prompt; required when there is no terminal).
- `--models <id,id>` or `--all` (Pi): which chat models to add; with neither, a numbered list is shown. Other tools take the per-tool flags in the table below.
- `--dry-run` prints the resulting file with the key masked; `-y, --yes` skips the confirmation.

Only the `literouter` entry is changed; everything else in the file is kept. The previous file is saved next to it as `<file>.bak-<timestamp>`, the new one is written atomically with mode 0600, and a run that changes nothing writes nothing.

| Tool | File | What is written |
| --- | --- | --- |
| `pi` | `~/.pi/agent/models.json` (`$PI_CODING_AGENT_DIR`) | `providers.literouter` with each model's image input, reasoning, context/output limits and thinking levels; pick it in Pi with `/model` |
| `claude-code` | `~/.claude/settings.json` (`$CLAUDE_CONFIG_DIR`) | `env.ANTHROPIC_BASE_URL` (the server root; Claude Code adds `/v1/messages`), `env.ANTHROPIC_AUTH_TOKEN`, and the tier models from `--opus`, `--sonnet`, `--haiku`, `--fable` (asked for in a terminal) |
| `codex` | `~/.codex/config.toml` (`$CODEX_HOME`) | `[model_providers.literouter]` (Responses API on `<server>/v1`, key as a static `Authorization` header) and `[profiles.literouter]` with `--model`; run `codex --profile literouter`, or pass `--default` to make it the default profile |

---

## 💾 Data Location

- **macOS/Linux**: `~/.literouter/db/data.sqlite`
- **Windows**: `%APPDATA%\literouter\db\data.sqlite`
- **Docker**: `/app/data/db/data.sqlite` (mount `$HOME/.literouter` to persist)
- **Legacy**: if only `~/.9router` (`%APPDATA%\9router`) exists it is used as it is; rename it to `~/.literouter` once no old 9router is running. `DATA_DIR` overrides all of this.

---

## 🙏 Acknowledgments

- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** - Original Go implementation

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.
