# LiteRouter

An OpenAI-compatible routing gateway and dashboard for coding tools: one endpoint, many upstream providers, with fallback, account rotation and quota tracking. A maintained [9Router](https://github.com/decolua/9router) fork that runs on Bun.

## ✨ What it does

- 🔌 **One endpoint.** Point any OpenAI-compatible client at `/v1`; LiteRouter translates each request to the upstream provider's format.
- 🌐 **40+ upstream providers** (OpenAI, Anthropic, Gemini, DeepSeek, Kimi, Grok, Cursor, Codex, Cloudflare and more) with their models and pricing in the dashboard.
- 🔁 **Combos and multi-account fallback.** Chain providers in a combo; when an account is rate-limited or a provider fails, the next one takes the turn.
- 🔑 **OAuth or API keys**, with token refresh handled for you.
- 📊 **Usage and quota tracking**: tokens, cost, latency, per-request details and quota windows, all in one SQLite database.
- 🪙 **RTK token saver**: optional compression of `tool_result` content before translation, leaving failed results alone.

## 🚀 Quick start

1. **Run it.** Use Docker or the source build below. The dashboard is at `http://localhost:20128/dashboard`.
2. **Add a provider.** In the dashboard, add an account with OAuth or an API key and enable it.
3. **Point your client at it.** Create a key on the **Endpoint** page, then set your client's base URL to `http://localhost:20128/v1` and its API key to that key. `GET /v1/models` lists what your keys can use.

## 🐳 Docker

From the `v1.0.1` tag the image is `ghcr.io/raufimusaddiq/literouter:1.0.1` (amd64 and arm64). [`docker-compose.yml`](docker-compose.yml) is a ready example: copy `.env.example` to `.env`, set `INITIAL_PASSWORD`, then `docker compose up -d`. Or without compose:

```bash
docker run -d --name literouter -p 20128:20128 \
  -v literouter-data:/app/data -e DATA_DIR=/app/data \
  --env-file .env ghcr.io/raufimusaddiq/literouter:1.0.1
```

The `literouter-data` volume holds the SQLite database (`db/data.sqlite`) and backups; keep it across upgrades. To upgrade, set a newer version tag and recreate the container with the same volume. Tags are published per release (`v*`); there is no `latest` tag.

## 📦 From source

Requires [Bun](https://bun.sh) 1.4.4 or newer.

```bash
git clone https://github.com/raufimusaddiq/literouter.git
cd literouter
bun install
bun run build
bun run start
```

`bun run start` reads the environment of the shell, not `.env`: export your settings, or copy `.env.example` to `.env` and run `bun --env-file=.env dist/app/index.js` instead. The `literouter` CLI package isn't on npm yet.

## 🔌 Use

Open `http://localhost:20128/dashboard`, add a provider, then point your client at `http://localhost:20128/v1`.

## ⚙️ Config

State is one SQLite file, `db/data.sqlite`, under `DATA_DIR`. Without it the data dir is `~/.literouter` (`%APPDATA%\literouter` on Windows); an existing `~/.9router` is used only when `~/.literouter` is absent, and `DATA_DIR` always wins. Set the variables in `.env.example` and **change `INITIAL_PASSWORD`**, `JWT_SECRET`, `API_KEY_SECRET` and `MACHINE_ID_SALT` before exposing it.

## 🔁 Migrating from 9router

Remove the old package with `npm rm -g 9router`, then use Docker or run from source. The same data is picked up through the `~/.9router` fallback (or point `DATA_DIR` at it), with no config or database changes. There is no `bun add -g literouter` yet.

## 🧰 Develop

```bash
bun install
bun run dev
bun run test
bunx --bun eslint .
```

More: [operations](docs/ops.md), [changelog](CHANGELOG.md), [upstream intake](AGENTS.md#upstream-intake).

## 🥟 Why Bun

LiteRouter is a rewrite of upstream 9Router (Next.js on Node) onto Bun. What that gives you:

- **One process, one port.** A single `Bun.serve` (`src/server/index.js`) serves the gateway at `/v1`, the dashboard and the compat APIs.
- **No Node, no npm, no Next.js.** The code is plain JavaScript ESM on Bun, and CI fails if a `node`, `npm` or `npx` call comes back.
- **SQLite without a native module.** Storage uses Bun's built-in `bun:sqlite`: settings, connections, combos, usage and request details live in one `db/data.sqlite`, with no `better-sqlite3` to compile.
- **The dashboard is built by `Bun.build`.** The React SPA has its own small router and lazy-loads charts and modals to stay inside the initial-JS budget in `tests/web/build.test.js`.
- **A single executable.** `bun run compile` builds one musl binary containing the server and dashboard, and the Docker image ships exactly that binary on Alpine. CI caps the bundled app at 30 MB (`dist/app`) and the image at 150 MB.
- **Tests on the same runtime.** CI runs the suite with `bun test --parallel`, which isolates each file instead of sharing one module registry.

## 📄 License

MIT
