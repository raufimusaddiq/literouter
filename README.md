# LiteRouter

Minimal AI router for coding tools. LiteRouter is a maintained [9Router](https://github.com/decolua/9router) fork: same provider and protocol core, fewer runtime surfaces.

[![CI](https://github.com/raufimusaddiq/literouter/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/raufimusaddiq/literouter/actions/workflows/test.yml) [![License](https://img.shields.io/github/license/raufimusaddiq/literouter.svg)](LICENSE)

## Why LiteRouter

- One OpenAI-compatible endpoint for coding clients and providers.
- Streaming, model routing, fallback, account rotation, quota tracking, dashboard, request logs, SQLite usage records.
- RTK token saver remains available.
- Minimal profile removes tunnel, Tailscale, and MITM runtime. No hidden compatibility process.
- SQLite stays authoritative. Redis only invalidates connection cache between instances.

## Quick start

Use the immutable production image for a merged `main` SHA:

```yaml
services:
  literouter:
    image: ghcr.io/raufimusaddiq/literouter-production:production-<full-main-sha>
    environment:
      DATA_DIR: /app/data
      MINIMAL_PROFILE: "true"
      MODEL_CATALOG_SYNC: off
      DISABLE_BACKGROUND_TOKEN_REFRESH: "true"
      REDIS_URL: redis://idx-redis:6379 # optional; cache only
    ports:
      - "20128:20128"
    volumes:
      - ./data:/app/data
```

```bash
docker compose up -d
```

Open `http://localhost:20128`. Configure providers in the dashboard, then point a compatible client at `http://localhost:20128/v1`.

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

LiteRouter is not an upstream drop-in package release. Build from this repository, install the CLI with `bun add -g literouter` (requires Bun 1.4.4 or newer; run `npm rm -g 9router` first if you had the upstream package), or use the production image above; `npm install -g 9router` installs upstream 9Router.

## Operations

Production topology, deploy, rollback and backup: [docs/ops.md](docs/ops.md). Release notes: [CHANGELOG.md](CHANGELOG.md).

## Upstream

LiteRouter tracks [9Router](https://github.com/decolua/9router). Upstream is still Next.js on Node, so fixes come over by reviewed cherry-picks, rewritten to Bun where they touch Next or Node-only code. The steps are in [AGENTS.md](AGENTS.md#upstream-intake).

Licensed under [MIT](LICENSE). Upstream 9Router attribution remains in [9Router](https://github.com/decolua/9router).
