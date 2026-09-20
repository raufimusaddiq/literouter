# LiteRouter

Minimal AI router for coding tools. LiteRouter is a maintained [9Router](https://github.com/decolua/9router) fork: same provider and protocol core, fewer runtime surfaces.

[![CI](https://github.com/raufimusaddiq/literouter/actions/workflows/test.yml/badge.svg?branch=staging)](https://github.com/raufimusaddiq/literouter/actions/workflows/test.yml) [![License](https://img.shields.io/github/license/raufimusaddiq/literouter.svg)](LICENSE)

## Why LiteRouter

- One OpenAI-compatible endpoint for coding clients and providers.
- Streaming, model routing, fallback, account rotation, quota tracking, dashboard, request logs, SQLite usage records.
- RTK token saver remains available.
- Minimal profile removes tunnel, Tailscale, and MITM runtime. No hidden compatibility process.
- SQLite stays authoritative. Redis only invalidates connection cache between instances.

## Quick start

Use the tested staging image:

```yaml
services:
  literouter:
    image: ghcr.io/raufimusaddiq/literouter-staging:staging-latest
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

For the repository staging deployment, use [`compose.staging.yml`](compose.staging.yml). Image builds run in GitHub Actions; the host pulls published images.

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

LiteRouter is not an upstream drop-in package release. Build from this repository or use the staging image above; `npm install -g 9router` installs upstream 9Router.

## Measured staging baseline

All figures are documented with method and limits in the [baseline report](docs/literouter-baseline/phase-latency-resource.md).

| Measurement | Production 9Router | LiteRouter staging |
| --- | ---: | ---: |
| Mock-router median latency, n=30 | 16.53 ms | 13.64 ms |
| Mock-router p95 latency, n=30 | 25.36 ms | 19.40 ms |
| Kenari `kn/deepseek-v4-1-flash` median, n=24 | 1715 ms | 1580 ms |
| Kenari `kn/deepseek-v4-1-flash` p95, n=24 | 2053 ms | 2062 ms |
| Post-burst RSS | 236.6 MiB | 72.3 MiB |
| Image size | 1.03 GB | 1.03 GB |

The image is not smaller. Runtime memory is. Public-model tail latency is effectively equal; controlled router overhead is lower.

## Provider notes

Provider availability changes. Current verified notes:

| Provider | Status |
| --- | --- |
| Kiro | `kr/glm-5`, `kr/deepseek-3.2`, `kr/qwen3-coder-next`; roughly 50 credits/month |
| OpenCode Free | `oc/` models; unauthenticated rotating catalog |
| Vertex | Gemini preview and Flash models |
| iFlow | Paid |
| Qwen Code | OAuth free tier ended |
| Gemini CLI | Shut down/deprecated |

Use the dashboard model list as the live source of truth.

## Operations

- [PR and deployment runbook](docs/literouter-baseline/pr-merge-runbook.md)
- [Minimal profile boundary](docs/literouter-baseline/phase-minimal-boundary.md)
- [Baseline index](docs/literouter-baseline/README.md)
- [Changelog](CHANGELOG.md)

## Upstream

LiteRouter tracks [9Router](https://github.com/decolua/9router). Keep local changes focused; bring upstream fixes over by reviewing and cherry-picking them.

Licensed under [MIT](LICENSE). Upstream 9Router attribution remains in [9Router](https://github.com/decolua/9router).
