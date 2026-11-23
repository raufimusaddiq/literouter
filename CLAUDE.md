# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

LiteRouter (`9router-app`) — a local AI routing gateway + dashboard. A single `Bun.serve` process serves the gateway, the dashboard/compat APIs and the dashboard, a React SPA that `bun scripts/build-web.mjs` builds with `Bun.build`. It exposes one OpenAI-compatible endpoint (`/v1/*`) and routes traffic across 40+ upstream providers with format translation, model-combo fallback, multi-account fallback, OAuth/API-key credential management, token refresh, and quota/usage tracking. This is the minimal profile: no tunnel/Tailscale/MITM runtime, no cloud sync, no CLI-tools writers.

Two published artifacts live in this one repo:
- The **dashboard + gateway** (root `package.json`, `9router-app`) — the `Bun.serve` server (`src/server/index.js`) that does the actual routing and serves the dashboard.
- The **CLI launcher** (`cli/`, published to npm as `literouter`) — a separate package that installs/starts the server and manages the tray. It has its own `package.json`, version, and build.

The code lives in `src/` (`Bun.serve` server in `src/server/`, route handlers under `src/app/api/`, and the dashboard SPA under `src/web/`: its in-house router, pages and entry, with the shared components in `src/shared/components`), `open-sse/` (the provider-agnostic routing/translation engine), `cli/` (the Bun launcher package, which ships the server bundle in `cli/app`), and `tests/`.

## Commands

Dashboard/gateway (run from repo root):
```bash
cp .env.example .env
bun install
PORT=20128 bun --hot src/server/index.js     # dev (same as `bun run dev`), hot-reloads the route table and handlers
PORT=20128 HOSTNAME=0.0.0.0 bun src/server/index.js   # production (same as `bun run start`)
```

The server is `Bun.serve` (`src/server/index.js`); there is no Next.js, Node or npm anywhere in the repo, with one exception: the READMEs tell users migrating from the upstream package to run `npm rm -g 9router` to remove it. `bun --hot` sees the real peer address of every connection, so development behaves like production: `/` redirects to `/dashboard`, the localhost-only routes (`/api/oauth/cursor/auto-import`, `/api/oauth/kiro/auto-import`, `/api/auth/reset-password`, `/api/headroom/*`) work from the machine itself, and LAN/self-hosted provider nodes validate. A direct loopback request with no proxy marker is local; Cloudflare to Caddy to loopback is remote (`src/server/trust.js`).
- Build: `bun run build` bundles the server and the dashboard SPA into `dist/app` (`bun scripts/build.mjs`; run it with `bun run start`, which is `cd dist/app && bun index.js`). `bun run compile` / `bun run compile:arm64` produce one musl executable in `dist/bin` (that is what the Docker image ships). `bun run build:web` only rebuilds the SPA. A bundled or compiled run reads its assets next to itself; unbundled production reads `LITEROUTER_SPA_DIR` or `dist/web` (a missing build answers 500); otherwise the SPA builds per process into `dist/web-dev/<pid>` and rebuilds when `src/` or `open-sse/` change (`src/server/spaBuild.js`). `tests/web/build.test.js` holds the initial-JS size budget. `bun.lock` is the only lockfile (`cli/bun.lock` for the launcher).
- Default runtime port is **20128** (dashboard at `/dashboard`, API at `/v1`).
- Lint: `bun --bun run eslint .` (flat config `eslint.config.mjs`: `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y` and `eslint-plugin-import` used directly, plus `local/no-comments`; no `eslint-config-next`, see `docs/adr/dashboard.md`).

CLI package (`cli/`):
```bash
bun run cli:pack       # build the CLI and pack it from root
cd cli && bun run dev  # bun --watch cli.js
cd cli && bun test
```

**Always run the suite with `--parallel`** (`cd tests && bun test --parallel`, or the `test` script). Plain `bun test` over the whole tree shares one module registry across files and can hang. Running a single file without it is fine.

Tests (`bun test`, in `tests/`, an **independent** ESM package; the root `test` script (`bun run test`) just calls `cd tests && bun test --parallel`):
```bash
bun install                             # ROOT deps first: tests import from src/, which resolves the app's own dependencies from the root node_modules
cd tests && bun install                 # tests' own install (devDependencies: bcryptjs for the password-bcrypt-compat test, `compression` 1.7.5 for the sse-no-compression test, and happy-dom plus its global registrator for the web tests)
cd tests && bun test --parallel         # all tests
cd tests && bun test unit/capabilities.test.js   # single file (path relative to tests/)
cd tests && CI=true bun test --parallel --reporter=junit --reporter-outfile=../test-results.xml   # what CI runs
```
> Test files import the mock helper as `import { vi } from "#test/vi"` (`tests/helpers/vi.js`, design notes in `docs/adr/testing.md`). `tests/bunfig.toml` holds the runner config.
>
> CI runs the workflow in `.github/workflows/test.yml`; expected red is 0. Judge regressions with `bun tests/__baseline__/verify-no-regression.mjs test-results.xml`.
> - `tests/server/*.test.js` start the real server (`startServer({ port: 0, hostname: "127.0.0.1" })`) and cover trust, h2c, body limit, timeouts, disconnect, SIGTERM and the route table; `tests/server/no-next-server.test.js` guards that Next's server pieces stay deleted.
- `*.real.test.js` under `tests/translator/real/` make live provider calls — skip unless credentials are set.
- Regression baselines: `tests/__baseline__/verify-*.mjs` compare against committed snapshots (providers, aliases, OAuth URLs). Run these after touching provider registry / alias logic.

**Tests stay lean** (`docs/adr/testing.md`). There is no per-file count guard, so the rules below are the guard:
- One behaviour per test; the title names the behaviour, not the function.
- No copy-pasted cases: cases that share a body and differ only in data are one `it.each` / `describe.each` table, with the real per-case differences as columns (a model version or provider id is a row, not a new file).
- Shared helpers live only in `tests/helpers/` (plus the per-suite `helpers/` dirs) and are deleted in the PR that removes their last user.
- Every fixture file is referenced by at least one test or script.
- Every `*.test.js` has an assertion (checked in CI). No test only asserts helpers it defines itself (review rule, not checked).
- Merging or deleting tests needs a before/after assertion proof in the PR: name the cases and show every expectation survives.
- `bun scripts/check-test-hygiene.mjs --check` runs in CI and fails on an unreferenced fixture or helper, a test file with no `expect(`, and a duplicate test title within a file. One-behaviour and no-restating stay review rules.

## Architecture

Two authoritative docs already exist — read them before working in these areas rather than re-deriving:
- `open-sse/AGENTS.md` — the routing/translation engine's own conventions and "how to add a provider/executor/translator". **Read this before editing anything under `open-sse/`.**

### Request flow (the thing to understand first)
`Bun.serve` routes (`src/server/routes.js`, generated from `src/app/api/**/route.js`; aliases such as `/v1/*` → `api/v1/*` are concrete entries)
→ `src/server/guard.js` (auth, local-only and minimal-profile gates, after `trust.js` has built the request context)
→ `src/server/adapter.js` (method dispatch, calls the route handler)
→ `src/sse/handlers/chat.js` (parse, combo expansion, account-selection loop)
→ `open-sse/handlers/chatCore.js` (detect source format, translate request, dispatch to executor, retry/refresh, stream setup)
→ `open-sse/executors/*` (per-provider upstream call; `default.js` handles any OpenAI-compatible provider)
→ `open-sse/translator/*` (client format ↔ provider format)
→ SSE back to client.

`src/sse/` is the app-side entry glue; `open-sse/` is the provider-agnostic engine (also usable standalone). Cross that boundary consciously. Pages, `public/` files and the manifest are served by the same `Bun.serve` fallback (`spa.js`, `static.js`) after the guard; the SPA index is `src/server/spa.js` reading the `Bun.build` output, with boot data and head tags injected per request.

### Translator engine (`open-sse/translator/`)
- Pivots through **OpenAI as the intermediate format**. A translator registered on an exact `source:target` pair (e.g. `claude:kiro`) runs as a **direct route**, skipping the lossy double-hop. Prefer a direct route for fragile pairs (thinking blocks, tool ids, non-base64 images, `is_error`).
- Translators **self-register** via `register(from, to, reqFn, resFn)` as an import side effect — a new translator file MUST be imported in `open-sse/translator/index.js` or it never runs.
- Never hardcode role/block/model strings — use `open-sse/translator/schema/` and `open-sse/config/` constants. Config-driven and DRY is enforced by convention here.

### Provider registry (`open-sse/providers/registry/*`)
- One file per provider. `providers/registry/index.js` is an **auto-generated** static import list — regenerate it with `scripts/injectDisplayToRegistry.mjs`, don't hand-edit.
- Add a provider: copy `providers/REGISTRY_TEMPLATE.js`, add models to `config/providerModels.js`. Only add an executor for non-OpenAI-compatible upstreams.

### Persistence — IMPORTANT
State is **no longer `db.json`**. It's a SQLite layer under `src/lib/db/` on `bun:sqlite` only (`driver.js` throws without the Bun runtime); the former `better-sqlite3`, `node:sqlite` and `sql.js` fallbacks are gone.
- `src/lib/localDb.js` is a **backward-compat shim** re-exporting `src/lib/db/index.js`. New code should import from `@/lib/db/index.js`; per-entity logic lives in `src/lib/db/repos/*`. Schema/migrations in `src/lib/db/migrations/`.
- DB file location resolves via `src/lib/db/paths.js` from `DATA_DIR` (`src/lib/dataDir.js`), else `~/.9router/` (`%APPDATA%\9router` on Windows). The file is `<data dir>/db/data.sqlite`.
- Usage and request details live in the same SQLite file and follow `DATA_DIR`. `src/lib/usageDb.js` and `src/lib/requestDetailsDb.js` re-export the repos in `src/lib/db/`; `usage.json` and the other `LEGACY_FILES` in `paths.js` are only read by the one-time import. File request logs (`ENABLE_REQUEST_LOGS=true`, `open-sse/utils/requestLogger.js`) are written to `./logs` under the process working directory, not `DATA_DIR`.

### RTK token saver (`open-sse/rtk/`)
Pre-translate hooks that compress `tool_result` content in-place to cut tokens. **Fail-open**: any error returns null and leaves the body untouched — never throw out of them. Skips `is_error`/`status:"error"` results to preserve traces.

## Conventions & gotchas

- Plain JavaScript (ESM), no TypeScript. `@/*` path alias → `src/*` (`jsconfig.json`).
- **Comments:** code comments are banned, enforced by the `local/no-comments` ESLint rule and `.comment-baseline.json` (a ratchet that only goes down; `bun scripts/comments/ratchet.mjs --check`). Record non-obvious decisions as short bullets in the matching `docs/adr/<topic>.md` instead (rule, why, `Where:`; no numbered ADRs). Run `/delete-comment` to audit again. Directives such as `eslint-disable` and magic bundler comments (e.g. turbopack/webpack hints) are allowed.
- Client IP and locality come from the TCP socket, never from headers: `src/server/trust.js` builds `{ peerIp, clientIp, isLocal }` per request (stored by `src/server/context.js`), trusts `X-Real-IP` / the rightmost `X-Forwarded-For` hop only from a loopback peer, and `src/server/index.js` strips `x-forwarded-for` and the retired `x-9r-*` peer headers before the guard. No source may read `NINEROUTER_PEER_TOKEN` or `x-9r-real-ip` (guard test). Preserve this when touching request/IP/rate-limit code; `docs/adr/security.md` has the rules.
- `tests/web/no-next-imports.test.js` is the Next-leftover gate: it guards `src`, `open-sse`, `scripts` and `cli/src` against `next/*` imports, `NextResponse`, `.nextUrl` and route segment exports (`dynamic`, `maxDuration`, `revalidate`), the root `package.json`, and that `src/app` holds only `api/`.
- Security-sensitive env: `JWT_SECRET` (session cookie), `INITIAL_PASSWORD` (default `123456` — must override), `API_KEY_SECRET`, `MACHINE_ID_SALT`. Full env contract in `.env.example` (there is no `ARCHITECTURE.md` in the tree).
- Binary/protobuf upstreams (kiro EventStream, cursor protobuf, commandcode NDJSON) don't round-trip through OpenAI — they're handled inside their own executor, not the translator.
- Versioning: root and `cli/` are versioned independently; changes are logged in `CHANGELOG.md`. Commit style is Conventional Commits (`fix(translator): …`, `feat(...)`).
