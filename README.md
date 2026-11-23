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

From the `v1.0.0` tag the image is `ghcr.io/raufimusaddiq/literouter:1.0.0` (amd64 and arm64):

```bash
docker run -d -p 20128:20128 -v "$HOME/.9router:/app/data" -e DATA_DIR=/app/data --name literouter ghcr.io/raufimusaddiq/literouter:1.0.0
```

See [DOCKER.md](DOCKER.md) for the volume layout and building the image.

## Use

Open `http://localhost:20128/dashboard`, add a provider, then point your client at `http://localhost:20128/v1`.

## Config

State is one SQLite file, `db/data.sqlite`, under `DATA_DIR` (default `~/.9router/`, `%APPDATA%\9router` on Windows). Copy `.env.example` to `.env` and **change `INITIAL_PASSWORD`**, `JWT_SECRET`, `API_KEY_SECRET` and `MACHINE_ID_SALT` before exposing it.

## Migrating from 9router

```bash
npm rm -g 9router
bun add -g literouter
```

Same data directory, no config or database changes.

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
