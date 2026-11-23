# LiteRouter

An OpenAI-compatible routing gateway and dashboard for coding tools: one endpoint, many upstream providers, with fallback, account rotation and quota tracking. A maintained [9Router](https://github.com/decolua/9router) fork that runs on Bun.

## Install

Requires [Bun](https://bun.sh) 1.4.4 or newer.

```bash
bun add -g literouter
literouter
```

Or run it once without installing: `bunx literouter`.

## Docker

From the `v1.0.0` tag the image is `ghcr.io/raufimusaddiq/literouter:1.0.0` (amd64 and arm64). [`docker-compose.yml`](docker-compose.yml) is a ready example: copy `.env.example` to `.env`, set `INITIAL_PASSWORD`, then `docker compose up -d`. Or without compose:

```bash
docker run -d --name literouter -p 20128:20128 \
  -v literouter-data:/app/data -e DATA_DIR=/app/data \
  --env-file .env ghcr.io/raufimusaddiq/literouter:1.0.0
```

The `literouter-data` volume holds the SQLite database (`db/data.sqlite`) and backups; keep it across upgrades. To upgrade, set a newer version tag and recreate the container with the same volume. Tags are published per release (`v*`); there is no `latest` tag.

## Use

Open `http://localhost:20128/dashboard`, add a provider, then point your client at `http://localhost:20128/v1`.

## Config

State is one SQLite file, `db/data.sqlite`, under `DATA_DIR`. Without it the data dir is `~/.literouter` (`%APPDATA%\literouter` on Windows); an existing `~/.9router` is used only when `~/.literouter` is absent, and `DATA_DIR` always wins. Copy `.env.example` to `.env` and **change `INITIAL_PASSWORD`**, `JWT_SECRET`, `API_KEY_SECRET` and `MACHINE_ID_SALT` before exposing it.

## Migrating from 9router

```bash
npm rm -g 9router
bun add -g literouter
```

Same data, no config or database changes: an existing `~/.9router` keeps being used.

## Develop

```bash
bun install
bun run dev
bun run test
bunx --bun eslint .
```

More: [operations](docs/ops.md), [changelog](CHANGELOG.md), [upstream intake](AGENTS.md#upstream-intake).

## License

MIT
