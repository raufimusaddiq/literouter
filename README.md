# LiteRouter

An OpenAI-compatible routing gateway and dashboard for coding tools: one endpoint, many upstream providers, with fallback, account rotation and quota tracking. A maintained [9Router](https://github.com/decolua/9router) fork that runs on Bun.

## Docker

From the `v1.0.0` tag the image is `ghcr.io/raufimusaddiq/literouter:1.0.0` (amd64 and arm64). [`docker-compose.yml`](docker-compose.yml) is a ready example: copy `.env.example` to `.env`, set `INITIAL_PASSWORD`, then `docker compose up -d`. Or without compose:

```bash
docker run -d --name literouter -p 20128:20128 \
  -v literouter-data:/app/data -e DATA_DIR=/app/data \
  --env-file .env ghcr.io/raufimusaddiq/literouter:1.0.0
```

The `literouter-data` volume holds the SQLite database (`db/data.sqlite`) and backups; keep it across upgrades. To upgrade, set a newer version tag and recreate the container with the same volume. Tags are published per release (`v*`); there is no `latest` tag.

## From source

Requires [Bun](https://bun.sh) 1.4.4 or newer.

```bash
git clone https://github.com/raufimusaddiq/literouter.git
cd literouter
bun install
bun run build
bun run start
```

`bun run start` reads the environment of the shell, not `.env`: export your settings, or copy `.env.example` to `.env` and run `bun --env-file=.env dist/app/index.js` instead. The `literouter` CLI package isn't on npm yet.

## Use

Open `http://localhost:20128/dashboard`, add a provider, then point your client at `http://localhost:20128/v1`.

## Config

State is one SQLite file, `db/data.sqlite`, under `DATA_DIR`. Without it the data dir is `~/.literouter` (`%APPDATA%\literouter` on Windows); an existing `~/.9router` is used only when `~/.literouter` is absent, and `DATA_DIR` always wins. Set the variables in `.env.example` and **change `INITIAL_PASSWORD`**, `JWT_SECRET`, `API_KEY_SECRET` and `MACHINE_ID_SALT` before exposing it.

## Migrating from 9router

Remove the old package with `npm rm -g 9router`, then use Docker or run from source. The same data is picked up through the `~/.9router` fallback (or point `DATA_DIR` at it), with no config or database changes. There is no `bun add -g literouter` yet.

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
