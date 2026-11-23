# Docker

Run LiteRouter in a container. Published image: `ghcr.io/raufimusaddiq/literouter:1.0.0` (published by the `v1.0.0` tag; `ghcr.io/raufimusaddiq/literouter:<version>` for later releases) — multi-platform `linux/amd64` + `linux/arm64`. The runtime is Bun; the image is Alpine plus one compiled executable.

---

# 👤 For Users

## Quick start

```bash
docker run -d \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  --name literouter \
  ghcr.io/raufimusaddiq/literouter:1.0.0
```

App listens on port `20128`. Open: http://localhost:20128

## Manage container

```bash
docker logs -f literouter        # view logs
docker stop literouter           # stop
docker start literouter          # start again
docker rm -f literouter          # remove
```

## Data persistence

```bash
-v "$HOME/.9router:/app/data" \
-e DATA_DIR=/app/data
```

Without `DATA_DIR`, the app falls back to `~/.9router/` (macOS/Linux) or `%APPDATA%\9router\` (Windows). In the container, `DATA_DIR=/app/data` makes the bind mount work.

Data layout under `$DATA_DIR/`:

```text
$DATA_DIR/
├── db/
│   ├── data.sqlite       # main SQLite database
│   └── backups/          # auto backups
└── ...                   # other runtime files
```

Upgrading from the Node build of 9Router or LiteRouter: keep the same volume and `DATA_DIR`. Nothing in the data or the environment changes.

Host path: `$HOME/.9router/db/data.sqlite`
Container path: `/app/data/db/data.sqlite`

## Optional env vars

```bash
docker run -d \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -e DEBUG=true \
  --name literouter \
  ghcr.io/raufimusaddiq/literouter:1.0.0
```

## Optional Headroom sidecar

The LiteRouter image does not bundle Python or Headroom. To use Headroom in Docker, run it as a separate service and point LiteRouter at that proxy:

```yaml
services:
  literouter:
    image: ghcr.io/raufimusaddiq/literouter:1.0.0
    ports:
      - "20128:20128"
    volumes:
      - "$HOME/.9router:/app/data"
    environment:
      DATA_DIR: /app/data
      HEADROOM_URL: http://headroom:8787
    depends_on:
      - headroom

  headroom:
    image: ghcr.io/chopratejas/headroom:latest
    ports:
      - "8787:8787"
```

In the dashboard, open `Endpoint` → `Token Saver` → `Headroom`, confirm the URL is `http://headroom:8787`, recheck status, then enable Headroom.

If Headroom runs on the Docker host instead of as a sidecar, use `http://host.docker.internal:8787` on macOS/Windows. On Linux, add `--add-host=host.docker.internal:host-gateway` or the equivalent compose `extra_hosts` entry.

## Update to a new version

```bash
docker pull ghcr.io/raufimusaddiq/literouter:<new version>
docker rm -f literouter
# re-run the quick start command
```

---

# 🛠 For Developers

## TLS trust store

The image sets `LITEROUTER_SYSTEM_CA=1`: at startup the server (`src/server/ca.js`, ADR 0001 D9) replaces the runtime's bundled CA roots with the container's OS bundle for `fetch` and `node:tls` alike (`/etc/ssl/certs`, from `ca-certificates`), so a root removed from the OS bundle is no longer trusted by any outbound client. The server exits at boot if the OS bundle is empty. Rebuild the image to pick up a refreshed `ca-certificates`.

## Build image locally (test)

The image is Alpine plus one compiled executable (`/app/literouter`), at most 150 MB (measured 116.3 MB for linux/amd64). The builder stage runs on the build platform and cross-compiles the musl target, so an arm64 build needs QEMU only for the runner stage's `apk` step.

```bash
docker build -t literouter .

docker run --rm -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  literouter
```

The executable doubles as the `bun` CLI when `BUN_BE_BUN=1` is set, for ad-hoc checks in a running container:

```bash
docker exec -e BUN_BE_BUN=1 <container> /app/literouter -e "console.log(Bun.version)"
```

The runtime is Bun (JavaScriptCore), so V8's `--max-old-space-size` does nothing. Cap memory with `mem_limit` (compose) or `docker run --memory`; `BUN_OPTIONS=--smol` is the opt-in knob for a smaller heap.

## Publish (automatic via CI)

A push to `staging` builds both platforms (amd64 and arm64) and publishes only `ghcr.io/<repo>-staging:staging-<sha>`. Production images are `ghcr.io/<repo>-production:production-<full-sha>`, and the deploy scripts accept only that form.

Pushing a `v*` tag (for example `v1.0.0`) runs `.github/workflows/docker-publish.yml`, which publishes `ghcr.io/<repo>:<version>` (and `latest` when the workflow runs on the default branch).
