# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

LiteRouter (`9router-app`) — a local AI routing gateway + Next.js dashboard. It exposes one OpenAI-compatible endpoint (`/v1/*`) and routes traffic across 40+ upstream providers with format translation, model-combo fallback, multi-account fallback, OAuth/API-key credential management, token refresh, and quota/usage tracking. This is the minimal profile: no tunnel/Tailscale/MITM runtime, no cloud sync, no CLI-tools writers.

Two published artifacts live in this one repo:
- The **dashboard + gateway** (root `package.json`, `9router-app`) — the Next.js server that does the actual routing.
- The **CLI launcher** (`cli/`, published to npm as `9router`) — a separate package that installs/starts the server and manages the tray. It has its own `package.json`, version, and build.

The code lives in `src/` (Next.js app + dashboard/compat APIs), `open-sse/` (the provider-agnostic routing/translation engine), `cli/` (the launcher package), and `tests/`.

## Commands

Dashboard/gateway (run from repo root):
```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev   # dev (webpack, port 20127 by default via next dev)
npm run build && PORT=20128 HOSTNAME=0.0.0.0 npm run start           # production
```

`npm run dev` runs bare `next dev`, which never loads `custom-server.js`. Only
that wrapper stamps the per-process `x-9r-peer-token` that proves a peer address,
so under `next dev` every request is treated as remote: LAN/self-hosted provider
nodes fail validation with `400`, the localhost-only routes
(`/api/oauth/cursor/auto-import`, `/api/oauth/kiro/auto-import`,
`/api/auth/reset-password`, `/api/headroom/*`) return `403`, and keyless `/v1`
calls return `401`. Use `npm run start` against a built app if you need the local
operator view; it loads the wrapper and grants it over loopback.
- Bun variants: `npm run dev:bun` / `build:bun` / `start:bun` (`prebuild:bun` regenerates the provider icon manifest; CI builds with `bun run build:bun`). Root `bun.lock` sits beside `package-lock.json`, which stays until Plan 4 because the Dockerfile uses `npm ci`.
- Default runtime port is **20128** (dashboard at `/dashboard`, API at `/v1`).
- Lint: `bunx --bun eslint .` (config `eslint.config.mjs`, extends `eslint-config-next`).

CLI package (`cli/`):
```bash
npm run cli:pack       # build + npm pack from root
cd cli && npm run dev  # nodemon watch
```

**Always run the suite with `--parallel`** (`cd tests && bun test --parallel`, or the `test` script). Plain `bun test` over the whole tree shares one module registry across files and can hang. Running a single file without it is fine.

Tests (`bun test`, in `tests/`, an **independent** ESM package; the root `npm test` script just calls `cd tests && bun test --parallel`):
```bash
bun install                             # ROOT deps first: tests import from src/ which needs `open`, `sql.js`, etc.
cd tests && bun install                 # tests' own install (no dependencies today)
cd tests && bun test --parallel         # all tests
cd tests && bun test unit/capabilities.test.js   # single file (path relative to tests/)
cd tests && CI=true bun test --parallel --reporter=junit --reporter-outfile=../test-results.xml   # what CI runs
```
> Test files import the mock helper as `import { vi } from "#test/vi"` (`tests/helpers/vi.js`, design notes in `docs/adr/0052-test-harness.md`). `tests/bunfig.toml` holds the runner config.
>
> **Linux CI is green: expected red is 0** (3951 tests pass, 0 fail) and the Windows `tests/__baseline__/known-fails.txt` list is now empty. CI runs `bun test --parallel` with the junit reporter, then `git diff --exit-code -- tests` (fails if Bun wrote or changed a snapshot), then `bun tests/__baseline__/verify-no-regression.mjs test-results.xml` and `bun tests/__baseline__/verify-test-counts.mjs test-results.xml` (every baseline file keeps at least its recorded count), then `bun scripts/migrate-vitest-to-bun.mjs --check tests` (and `--snapshots --check`), `bunx --bun eslint .` (blocking; the React Compiler react-hooks rules are downgraded to warnings in `eslint.config.mjs` until that debt is cleared), `bun scripts/comments/ratchet.mjs --check`, and `bun run build:bun` with the standalone size budget. Judge regressions with the verify scripts.
> - **After merging `main`, run `bun scripts/migrate-vitest-to-bun.mjs tests` (and `bun scripts/migrate-vitest-to-bun.mjs tests --snapshots`)**, then run the suite and fix what fails. `main` still writes vitest-style tests.
> - `real/*.real.test.js` make live provider calls — need credentials, skip otherwise.
- `*.real.test.js` under `tests/translator/real/` make live provider calls — skip unless credentials are set.
- Regression baselines: `tests/__baseline__/verify-*.mjs` compare against committed snapshots (providers, aliases, OAuth URLs). Run these after touching provider registry / alias logic.

## Architecture

Two authoritative docs already exist — read them before working in these areas rather than re-deriving:
- `open-sse/AGENTS.md` — the routing/translation engine's own conventions and "how to add a provider/executor/translator". **Read this before editing anything under `open-sse/`.**

### Request flow (the thing to understand first)
`src/app/api/v1/*` route (Next rewrite maps `/v1/*` → `/api/v1/*` in `next.config.mjs`)
→ `src/sse/handlers/chat.js` (parse, combo expansion, account-selection loop)
→ `open-sse/handlers/chatCore.js` (detect source format, translate request, dispatch to executor, retry/refresh, stream setup)
→ `open-sse/executors/*` (per-provider upstream call; `default.js` handles any OpenAI-compatible provider)
→ `open-sse/translator/*` (client format ↔ provider format)
→ SSE back to client.

`src/sse/` is the app-side entry glue; `open-sse/` is the provider-agnostic engine (also usable standalone). Cross that boundary consciously.

### Translator engine (`open-sse/translator/`)
- Pivots through **OpenAI as the intermediate format**. A translator registered on an exact `source:target` pair (e.g. `claude:kiro`) runs as a **direct route**, skipping the lossy double-hop. Prefer a direct route for fragile pairs (thinking blocks, tool ids, non-base64 images, `is_error`).
- Translators **self-register** via `register(from, to, reqFn, resFn)` as an import side effect — a new translator file MUST be imported in `open-sse/translator/index.js` or it never runs.
- Never hardcode role/block/model strings — use `open-sse/translator/schema/` and `open-sse/config/` constants. Config-driven and DRY is enforced by convention here.

### Provider registry (`open-sse/providers/registry/*`)
- One file per provider. `providers/registry/index.js` is an **auto-generated** static import list — regenerate it with `scripts/injectDisplayToRegistry.mjs`, don't hand-edit.
- Add a provider: copy `providers/REGISTRY_TEMPLATE.js`, add models to `config/providerModels.js`. Only add an executor for non-OpenAI-compatible upstreams.

### Persistence — IMPORTANT (ARCHITECTURE.md is stale here)
State is **no longer `db.json`**. It's a SQLite layer under `src/lib/db/` with an adapter fallback chain (`driver.js`): `bun:sqlite` → `better-sqlite3` (optional native dep) → `node:sqlite` (Node ≥22.5) → `sql.js` (pure-JS fallback, always works). `better-sqlite3` is deliberately in `optionalDependencies` so install never fails without build tools.
- `src/lib/localDb.js` is a **backward-compat shim** re-exporting `src/lib/db/index.js`. New code should import from `@/lib/db/index.js`; per-entity logic lives in `src/lib/db/repos/*`. Schema/migrations in `src/lib/db/migrations/`.
- DB file location resolves via `src/lib/db/paths.js` (`DATA_DIR`, else `~/.9router/`).
- Usage/logs (`src/lib/usageDb.js`, `usage.json` + `log.txt`) still live under `~/.9router` and do **not** follow `DATA_DIR`.

### RTK token saver (`open-sse/rtk/`)
Pre-translate hooks that compress `tool_result` content in-place to cut tokens. **Fail-open**: any error returns null and leaves the body untouched — never throw out of them. Skips `is_error`/`status:"error"` results to preserve traces.

## Conventions & gotchas

- Plain JavaScript (ESM), no TypeScript. `@/*` path alias → `src/*` (`jsconfig.json`).
- **Comments:** code comments are banned, enforced by the `local/no-comments` ESLint rule and `.comment-baseline.json` (a ratchet that only goes down; `bun scripts/comments/ratchet.mjs --check`). Record non-obvious decisions in `docs/adr/` instead. Run `/delete-comment` to audit again. Directives such as `eslint-disable` and magic bundler comments (e.g. turbopack/webpack hints) are allowed.
- `custom-server.js` wraps the Next standalone server to derive client IP from the TCP socket and strip attacker-controlled `X-Forwarded-For` — trusting forwarding headers only from a loopback reverse proxy. Preserve this when touching request/IP/rate-limit code.
- Security-sensitive env: `JWT_SECRET` (session cookie), `INITIAL_PASSWORD` (default `123456` — must override), `API_KEY_SECRET`, `MACHINE_ID_SALT`. Full env contract in `.env.example` and ARCHITECTURE.md's env matrix.
- Binary/protobuf upstreams (kiro EventStream, cursor protobuf, commandcode NDJSON) don't round-trip through OpenAI — they're handled inside their own executor, not the translator.
- Versioning: root and `cli/` are versioned independently; changes are logged in `CHANGELOG.md`. Commit style is Conventional Commits (`fix(translator): …`, `feat(...)`).
