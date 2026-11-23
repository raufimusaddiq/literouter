# LiteRouter - FREE AI Router & Token Saver

**Never stop coding. Save 20-40% tokens with RTK + auto-fallback to FREE & cheap AI models.**

**Connect All AI Code Tools (Claude Code, Cursor, Antigravity, Copilot, Codex, Gemini, OpenCode, Cline, OpenClaw...) to 40+ AI Providers & 100+ Models.**

[![npm](https://img.shields.io/npm/v/literouter.svg)](https://www.npmjs.com/package/literouter)
[![License](https://img.shields.io/github/license/raufimusaddiq/literouter.svg)](https://github.com/raufimusaddiq/literouter/blob/main/LICENSE)

[Repository](https://github.com/raufimusaddiq/literouter) • [Docker guide](https://github.com/raufimusaddiq/literouter/blob/main/DOCKER.md)

---

## 🤔 Why LiteRouter?

**Stop wasting money, tokens and hitting limits:**

- ❌ Subscription quota expires unused every month
- ❌ Rate limits stop you mid-coding
- ❌ Tool outputs (git diff, grep, ls...) burn tokens fast
- ❌ Expensive APIs ($20-50/month per provider)

**LiteRouter solves this:**

- ✅ **RTK Token Saver** - Auto-compress tool_result, save 20-40% tokens
- ✅ **Maximize subscriptions** - Track quota, use every bit before reset
- ✅ **Auto fallback** - Subscription → Cheap → Free, zero downtime
- ✅ **Multi-account** - Round-robin between accounts per provider
- ✅ **Universal** - Works with any OpenAI/Claude-compatible CLI

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

See the [Docker guide](https://github.com/raufimusaddiq/literouter/blob/main/DOCKER.md) for the image, volume and update instructions.

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

`literouter stop` stops the server (and the launcher or tray process that started it) recorded in the pid file in the data directory (`~/.9router/server.pid` on macOS and Linux, `%APPDATA%\9router\server.pid` on Windows; `DATA_DIR` overrides both). It only stops the server it started itself and never a foreign process. It exits 0 with a message when nothing is running, and exits 1 only when the server is still listening after being stopped. The listener is found with `lsof` (macOS), `ss` or `/proc` (Linux), or `netstat` (Windows), so a minimal Linux image without those tools still works; when it cannot tell who listens but the pid file's process is alive and the port is open, it keeps the pid file and exits 1.

When an old Node `9router` server is running, `literouter` stops it and takes over its port, identifying it by its launcher, working directory or command line (the old server renames its process title). If a `next-server` (or a port whose listener cannot be determined) is not proven to be the old server, `literouter` prints a message asking you to stop it yourself if it is the old server, and exits 1 rather than start a second server on the same data directory.

**Dashboard**: `http://localhost:20128/dashboard`

---

## 🛠️ Supported CLI Tools

Claude-Code • OpenClaw • Codex • OpenCode • Cursor • Antigravity • Cline • Continue • Droid • Roo • Copilot • Kilo Code • Gemini CLI • Qwen Code • iFlow • Crush • Crusher • Aider

Any tool supporting OpenAI/Claude-compatible API works.

---

## 💾 Data Location

- **macOS/Linux**: `~/.9router/db/data.sqlite`
- **Windows**: `%APPDATA%/9router/db/data.sqlite`
- **Docker**: `/app/data/db/data.sqlite` (mount `$HOME/.9router` to persist)

---

## 📚 Documentation

Full docs, advanced setup, video tutorials & development guide:

- **GitHub**: https://github.com/raufimusaddiq/literouter
- **Full README**: https://github.com/raufimusaddiq/literouter/blob/main/README.md
- **Docker**: https://github.com/raufimusaddiq/literouter/blob/main/DOCKER.md

---

## 🙏 Acknowledgments

- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** - Original Go implementation

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.
