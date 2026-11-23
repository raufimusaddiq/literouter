# LiteRouter

Minimal AI router for coding tools. LiteRouter is a maintained [9Router](https://github.com/decolua/9router) fork: same provider and protocol core, fewer runtime surfaces.

[![CI](https://github.com/raufimusaddiq/literouter/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/raufimusaddiq/literouter/actions/workflows/test.yml) [![License](https://img.shields.io/github/license/raufimusaddiq/literouter.svg)](LICENSE)

## Why LiteRouter

- One OpenAI-compatible endpoint for coding clients and providers.
- Streaming, model routing, fallback, account rotation, quota tracking, dashboard, request logs, SQLite usage records.
- RTK token saver remains available.
- Minimal profile removes tunnel, Tailscale, and MITM runtime. No hidden compatibility process.
- SQLite stays authoritative. Redis only invalidates connection cache between instances.

## Docker

[`docker-compose.yml`](docker-compose.yml) is a ready example. Copy `.env.example` to `.env`, set `INITIAL_PASSWORD` (the default is `123456`), then:

```bash
docker compose up -d
```

Or without compose:

```bash
docker run -d --name literouter -p 20128:20128 \
  -v literouter-data:/app/data -e DATA_DIR=/app/data \
  --env-file .env ghcr.io/raufimusaddiq/literouter:1.0.0
```

Open `http://localhost:20128`, configure providers in the dashboard, then point a compatible client at `http://localhost:20128/v1`.

The `literouter-data` volume holds the SQLite database (`db/data.sqlite`) and backups; keep it across upgrades. To upgrade, set a newer version tag in the image line, then `docker compose pull && docker compose up -d` (or pull the tag and recreate the container with the same volume). Tags are published per release (`v*`); there is no `latest` tag.

For the repository production deployment, use [`compose.production.yml`](compose.production.yml). Image builds run in GitHub Actions; the host pulls published images.

## LiteRouter vs 9Router

| Area | LiteRouter | 9Router |
| --- | --- | --- |
| Router, providers, OpenAI/Claude transports | Retained | Retained |
| Dashboard, usage, request logs, SQLite | Retained | Retained |
| Token saver | Retained | Retained |
| Background model catalog sync | Off | On |
| Background token refresh | Off | On |
| Redis | Optional cache invalidation only | Varies by deployment |
| Tunnel, Tailscale, MITM runtime | Deleted | Included |
| Intended operation | Small, direct routing deployment | Full product surface |

LiteRouter is not an upstream drop-in package release. Build from this repository, install the CLI with `bun add -g literouter` (requires Bun 1.4.4 or newer; run `npm rm -g 9router` first if you had the upstream package), or use the Docker image above; `npm install -g 9router` installs upstream 9Router.

## Operations

Production topology, deploy, rollback and backup: [docs/ops.md](docs/ops.md). Release notes: [CHANGELOG.md](CHANGELOG.md).

## Upstream

LiteRouter tracks [9Router](https://github.com/decolua/9router). Upstream is still Next.js on Node, so fixes come over by reviewed cherry-picks, rewritten to Bun where they touch Next or Node-only code. The steps are in [AGENTS.md](AGENTS.md#upstream-intake).

Licensed under [MIT](LICENSE). Upstream 9Router attribution remains in [9Router](https://github.com/decolua/9router).
