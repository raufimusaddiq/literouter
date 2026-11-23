# LiteRouter - FREE AI Router & Token Saver

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

Run once without installing: `bunx literouter`. Auto-start on boot needs a global install (`bun add -g`), not `bunx`. Upgrade with `bun add -g literouter@latest`. If you installed the old `9router` package, remove it first with `npm rm -g 9router`.

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
