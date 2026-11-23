# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

LiteRouter (`9router-app`) — a local AI routing gateway + dashboard. A single `Bun.serve` process serves the gateway, the dashboard/compat APIs and the dashboard, a React SPA that `bun scripts/build-web.mjs` builds with `Bun.build`. It exposes one OpenAI-compatible endpoint (`/v1/*`) and routes traffic across 40+ upstream providers with format translation, model-combo fallback, multi-account fallback, OAuth/API-key credential management, token refresh, and quota/usage tracking. This is the minimal profile: no tunnel/Tailscale/MITM runtime, no cloud sync, no CLI-tools writers.

Two published artifacts live in this one repo:
- The **dashboard + gateway** (root `package.json`, `9router-app`) — the `Bun.serve` server (`src/server/index.js`) that does the actual routing and serves the dashboard.
- The **CLI launcher** (`cli/`, published to npm as `9router`) — a separate package that installs/starts the server and manages the tray. It has its own `package.json`, version, and build.

The code lives in `src/` (`Bun.serve` server in `src/server/`, route handlers under `src/app/api/`, and the dashboard SPA under `src/web/`: its in-house router, pages and entry, with the shared components in `src/shared/components`), `open-sse/` (the provider-agnostic routing/translation engine), `cli/` (the launcher package; still the Next-era launcher that bundles the Next standalone build until Plan 4 rebuilds it for Bun), and `tests/`.

## Commands

Dashboard/gateway (run from repo root):
```bash
cp .env.example .env
bun install
PORT=20128 bun --hot src/server/index.js     # dev (same as `bun run dev`), hot-reloads the route table and handlers
PORT=20128 HOSTNAME=0.0.0.0 bun src/server/index.js   # production (same as `bun run start`)
```

The server is `Bun.serve` (`src/server/index.js`); the root package no longer depends on Next (only `cli/` still bundles it, until Plan 4). `bun --hot` sees the real peer address of every connection, so development behaves like production: `/` redirects to `/dashboard`, the localhost-only routes (`/api/oauth/cursor/auto-import`, `/api/oauth/kiro/auto-import`, `/api/auth/reset-password`, `/api/headroom/*`) work from the machine itself, and LAN/self-hosted provider nodes validate. A direct loopback request with no proxy marker is local; Cloudflare to Caddy to loopback is remote (`src/server/trust.js`).
- Build: `bun run build:web` regenerates the provider icon manifest and writes the dashboard SPA to `dist/web` (`bun scripts/build-web.mjs`; `bun run build` calls it for now). The server reads `LITEROUTER_SPA_DIR` or `dist/web` when `NODE_ENV=production` (a missing build answers 500); otherwise it builds per process into `dist/web-dev/<pid>` and rebuilds when `src/` or `open-sse/` change (`src/server/spaBuild.js`). `tests/web/build.test.js` holds the initial-JS size budget. Root `bun.lock` sits beside `package-lock.json`, which stays until Plan 4 because the Dockerfile and `cli/` still describe the Next standalone build.
- Default runtime port is **20128** (dashboard at `/dashboard`, API at `/v1`).
- Lint: `bunx --bun eslint .` (flat config `eslint.config.mjs`: `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y` and `eslint-plugin-import` used directly, plus `local/no-comments`; no `eslint-config-next`, see `docs/adr/0054-dashboard-spa.md`).

CLI package (`cli/`):
```bash
npm run cli:pack       # build + npm pack from root
cd cli && npm run dev  # nodemon watch
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
> Test files import the mock helper as `import { vi } from "#test/vi"` (`tests/helpers/vi.js`, design notes in `docs/adr/0052-test-harness.md`). `tests/bunfig.toml` holds the runner config.
>
> **Linux CI is green: expected red is 0** and the Windows `tests/__baseline__/known-fails.txt` list is now empty. CI runs `bun test --parallel` with the junit reporter, then `git diff --exit-code -- tests` (fails if Bun wrote or changed a snapshot), then `bun tests/__baseline__/verify-no-regression.mjs test-results.xml` and `bun tests/__baseline__/verify-test-counts.mjs test-results.xml` (every baseline file keeps at least its recorded count; a file replaced by another is listed under `waived` in `test-counts.json`), then `bun scripts/migrate-vitest-to-bun.mjs --check tests` (and `--snapshots --check`), `bunx --bun eslint .` (blocking; the React Compiler react-hooks rules are downgraded to warnings in `eslint.config.mjs` until that debt is cleared), `bun scripts/comments/ratchet.mjs --check`, `bun scripts/gen-route-table.mjs --check`, `bun scripts/port-next-routes.mjs --check src`, the parity run (`bun tests/parity/run.mjs --target bun --out parity-actual`, then `compare.mjs` and `compare-upstream.mjs` against `tests/parity/expected`), and `bun run build:web`. Judge regressions with the verify scripts.
> - `tests/server/*.test.js` start the real server (`startServer({ port: 0, hostname: "127.0.0.1" })`) and cover trust, h2c, body limit, timeouts, disconnect, SIGTERM and the route table; `tests/server/no-next-server.test.js` guards that Next's server pieces stay deleted.
> - `tests/parity/` records the app's HTTP behaviour (`run.mjs`) and diffs it against the goldens recorded on Next (`expected/`), allowing only what `known-diffs.json` and `known-upstream-diffs.json` pin with a reason. `--target next` needs a checkout from before Task 14 of Plan 2, where `custom-server.js` still exists.
> - **After merging `main`, run `bun scripts/migrate-vitest-to-bun.mjs tests` (and `bun scripts/migrate-vitest-to-bun.mjs tests --snapshots`)**, then run the suite and fix what fails. `main` still writes vitest-style tests.
> - `real/*.real.test.js` make live provider calls — need credentials, skip otherwise.
- `*.real.test.js` under `tests/translator/real/` make live provider calls — skip unless credentials are set.
- Regression baselines: `tests/__baseline__/verify-*.mjs` compare against committed snapshots (providers, aliases, OAuth URLs). Run these after touching provider registry / alias logic.

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
- DB file location resolves via `src/lib/db/paths.js` (`DATA_DIR`, else `~/.9router/`).
- Usage/logs (`src/lib/usageDb.js`, `usage.json` + `log.txt`) still live under `~/.9router` and do **not** follow `DATA_DIR`.

### RTK token saver (`open-sse/rtk/`)
Pre-translate hooks that compress `tool_result` content in-place to cut tokens. **Fail-open**: any error returns null and leaves the body untouched — never throw out of them. Skips `is_error`/`status:"error"` results to preserve traces.

## Conventions & gotchas

- Plain JavaScript (ESM), no TypeScript. `@/*` path alias → `src/*` (`jsconfig.json`).
- **Comments:** code comments are banned, enforced by the `local/no-comments` ESLint rule and `.comment-baseline.json` (a ratchet that only goes down; `bun scripts/comments/ratchet.mjs --check`). Record non-obvious decisions in `docs/adr/` instead. Run `/delete-comment` to audit again. Directives such as `eslint-disable` and magic bundler comments (e.g. turbopack/webpack hints) are allowed.
- Client IP and locality come from the TCP socket, never from headers: `src/server/trust.js` builds `{ peerIp, clientIp, isLocal }` per request (stored by `src/server/context.js`), trusts `X-Real-IP` / the rightmost `X-Forwarded-For` hop only from a loopback peer, and `src/server/index.js` strips `x-forwarded-for` and the retired `x-9r-*` peer headers before the guard. No source may read `NINEROUTER_PEER_TOKEN` or `x-9r-real-ip` (guard test). Preserve this when touching request/IP/rate-limit code; ADR 0001 has the rules.
- `bun scripts/port-next-routes.mjs --check src` is the Next-leftover gate for the whole `src` tree; `tests/web/no-next-imports.test.js` also guards `src`, `open-sse`, `scripts` and `cli/src`, the root `package.json`, and that `src/app` holds only `api/`.
- Security-sensitive env: `JWT_SECRET` (session cookie), `INITIAL_PASSWORD` (default `123456` — must override), `API_KEY_SECRET`, `MACHINE_ID_SALT`. Full env contract in `.env.example` (there is no `ARCHITECTURE.md` in the tree).
- Binary/protobuf upstreams (kiro EventStream, cursor protobuf, commandcode NDJSON) don't round-trip through OpenAI — they're handled inside their own executor, not the translator.
- Versioning: root and `cli/` are versioned independently; changes are logged in `CHANGELOG.md`. Commit style is Conventional Commits (`fix(translator): …`, `feat(...)`).
