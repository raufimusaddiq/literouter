# LiteRouter on Bun, without Next.js — Design

Date: 2026-11-22
Branch: `staging` (the rewrite branch; merged to `main` at cutover)
Supersedes: the Go rewrite in `docs/literouter-v2-architecture-prd` (branch `origin/docs/literouter-v2-architecture-prd`). That PRD's **compatibility ledger (§5)** and **parity/test ideas (§19–20)** are still useful references; its Go runtime, Redis, and snapshot-compiler parts are abandoned.

## 1. Intent

Rewrite LiteRouter's runtime shell to run on **Bun with no web framework**, and remove **Next.js entirely** — from runtime, build, dependencies, and lint config.

Why (owner's words): smaller image, less memory, and "Next is bad". Today's production image is ~1.03 GB and the app carries a Next server runtime, a `custom-server.js` that monkey-patches Next's HTTP server, standalone-tracing workarounds, and three SQLite adapters.

Success looks like: the same product — every `/v1` endpoint, every `/api` route, every dashboard page, the npm CLI with tray, and the Docker image — running as a single compiled Bun executable, with an image around **110–130 MB** (measured: Bun 1.4.4 compiled musl executable = 98 MB, 46 MB gzipped) and lower RSS than today.

## 2. Goals

1. Zero `next`, `@next/*`, `eslint-config-next` in any `package.json`; no `next.config.mjs`, `src/proxy.js`, `src/instrumentation.js`, `custom-server.js`.
2. One HTTP server: `Bun.serve()` with its built-in `routes` table, serving `/v1/*`, `/v1beta/*`, `/codex/*`, `/responses`, all `/api/*`, the OAuth `/callback` page, and the dashboard.
3. Dashboard becomes a static React SPA, bundled by Bun (HTML imports + `bun-plugin-tailwind`), embedded in the executable.
4. Docker ships a `bun build --compile` executable; the CLI ships a Bun-run JS bundle (§6.7).
5. Docker image ≤ 150 MB uncompressed (target ~120 MB).
6. Idle and post-burst RSS measured and lower than the current Node/Next baseline (historical post-burst 72.3 MiB; re-measure current `main` before cutover so the comparison is fair).
7. Behaviour parity with `main` at cutover time — see §8 gates.
8. **Bun-native everywhere, no Node runtime anywhere** — server, CLI, tests, scripts, CI. Prefer Bun built-ins over npm deps and over `node:` APIs when Bun has an equivalent (`bun:sqlite`, `bun:test`, `Bun.serve`, `Bun.file`/`Bun.write`, `Bun.spawn`, `Bun.password`, `Bun.build`, native `fetch` with `proxy`, `crypto.randomUUID`). Use `node:` modules only where Bun has no native equivalent (e.g. `node:http2` client for Cursor, if Bun's fetch can't do it). Candidate deps to drop: `bcryptjs` → `Bun.password` (existing `$2a/$2b` hashes must still verify), `uuid` → `crypto.randomUUID`, `undici` → Bun `fetch`, `open` → `Bun.spawn`, `sql.js`, `better-sqlite3`. Builder confirms each swap is behaviour-identical before removing the dep.

## 3. Non-goals

- No change to routing, translation, combos, fallback, providers, pricing, quota, RTK, prompt-cache behaviour. `open-sse/` is kept as-is except for removing Next imports if any.
- No visual redesign of the dashboard. Same components, same Tailwind styles.
- No TypeScript migration.
- No DB schema change. The SQLite file written by today's app opens unchanged, and the old Node image can still open a DB touched by the new one (rollback safety).
- No renaming of data dir (`~/.9router`, `DATA_DIR`), env vars (`NINEROUTER_*`, `JWT_SECRET`, …), headers (`x-9r-*`), or cookie names. Only the npm package/bin is renamed (§6.7). *(Designer's call — keeps prod DB, clients and the CLI-token handshake working; renaming those can be a later, separate change.)*
- No Go, no Redis, no snapshot compiler.

## 4. Anti-goals (would be a failure even if it "works")

- Any client-visible change on `/v1` (status codes, headers, SSE framing, error bodies, prompt-cache hit rates).
- Weakening the trusted-proxy model: a request through Cloudflare → Caddy → loopback must still be classified **remote**; client-supplied `X-Forwarded-For` must still be untrusted except the rightmost hop from a loopback proxy; `TRUST_LOOPBACK_AS_LOCAL=false` must still work. (See memory: prod sits behind Caddy + Cloudflare at ai.musaddiqr.com.)
- Long LLM streams being cut by a server timeout (see §6.2 — Bun's default idle timeout is 10 s).
- A Windows CLI update that fails with `EBUSY` while the server is running.
- An image that is not meaningfully smaller.

## 5. Approaches considered

| Approach | Trade-off | Decision |
|---|---|---|
| **A. Bun only, no framework** — `Bun.serve` routes, Bun HTML-import bundler for the SPA, `bun:sqlite`, `--compile` | Fewest deps, smallest image; Bun's frontend bundler is younger than Vite (code-splitting/plugins may need care) | **Chosen by owner** |
| B. Bun + Hono + Vite | Less hand-written middleware/cookie code, mature frontend tooling; one more router + toolchain | Rejected — owner wants no framework |
| C. Keep Next as a static-export build tool, serve output from Bun | Fastest, but Next stays in the repo | Rejected — works against "Next is bad" |
| (D. Go rewrite — prior PRD) | Smallest binary (~20–30 MB) but full rewrite of engine | Abandoned by owner |

If the Bun frontend bundler proves inadequate for the dashboard, swapping only the dashboard build to Vite (dev-dependency only, no runtime impact) is an acceptable contained fallback — but try Bun first.

## 6. Design

### 6.1 What stays, what changes

| Area | Fate |
|---|---|
| `open-sse/` (engine, translators, executors, registry, RTK) | Unchanged |
| `src/lib/**`, `src/sse/**`, `src/shared/services/**`, `src/i18n`, `src/store` | Unchanged except Next imports |
| `src/app/api/**/route.js` (96 files) | Handlers kept; `NextResponse`/`NextRequest` usage replaced with Web `Response`/`Request` + tiny helpers; `export const dynamic/maxDuration` removed |
| `src/app/**/page.js`, layouts (16 pages, 2 layouts) | Ported to SPA routes |
| `src/proxy.js` + `src/dashboardGuard.js` | Guard logic kept, invoked by the Bun server before dispatch |
| `src/instrumentation.js` | Its `register()` body runs once at server start |
| `custom-server.js` | Deleted; its responsibilities move into the Bun server (§6.3, §6.4) |
| `next.config.mjs` rewrites/redirects/headers | Re-expressed in the Bun route table |
| DB driver chain | **`bun:sqlite` only.** The adapter fallback chain (`driver.js`, `nodeSqliteAdapter`, `sqljsAdapter`, better-sqlite3) is removed; the repos talk to one driver. DB import/restore that uses sql.js today is re-implemented on `bun:sqlite` (§9.3) |

Suggested layout (builder may adjust): `src/server/` (entry, route table, adapters, guard wiring, IP/trust, static), `src/web/` (SPA entry `index.html`, `main.jsx`, router, pages moved from `src/app`).

### 6.2 HTTP server (`Bun.serve`)

- **Route table**: explicit list mapping every current public path to its handler. Dynamic segments use Bun's `:param` syntax; Next 16 handler signature `(request, { params })` (params as a Promise) is preserved by the adapter so handler bodies change minimally.
- Carry over **every** `next.config.mjs` rewrite (`/v1/v1/*`, `/codex/*`, `/responses`, `/v1beta`…), redirect, and response header rule. Generate a manifest from `main`'s `src/app/api/**/route.js` + `next.config.mjs` and add a test asserting the Bun table covers it (this is also the **main-drift detector**, §7).
- **Timeouts**: Bun's default `idleTimeout` is 10 s (max 255). Streaming routes (`/v1/*` chat/responses/messages, SSE endpoints like console-logs/usage streams) must call `server.timeout(req, 0)` or the server must use a safe global value — streams that pause >10 s must not be cut. Cover with a test that holds a stream silent for >15 s.
- **Body limit**: `maxRequestBodySize` from `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` (default 128 MB, same parser as today).
- **h2c clients** (IntelliJ/JBR sending `Upgrade: h2c`): must get a normal HTTP/1.1 response, not a dropped connection. Port `tests/unit/*custom-server-h2c*.test.cjs` intent to the Bun server; if Bun mishandles it, add the minimal workaround.
- **Errors**: unknown `/api` → same 404 JSON shape as today; unknown dashboard path → SPA `index.html`.
- **Bootstrap at start**: run `instrumentation.register()` contents (weak-secret warning, console-log capture, catalog source install, catalog sync, `bootstrap.js`), plus `initOutboundProxy` (today imported from the root layout). Ensure it runs exactly once.

### 6.3 Client IP and local-operator trust

- Peer address comes from `server.requestIP(req)`; pass it to handlers via a per-request context (e.g. a `WeakMap<Request, ctx>` or a wrapped request), **not** via a header. The `x-9r-peer-token` / `x-9r-real-ip` mechanism is deleted — and any client-sent `x-9r-real-ip` must be ignored/stripped so old trust paths can't be spoofed.
- Keep the current semantics exactly: proxy markers on a loopback peer ⇒ remote (`src/lib/auth/proxyMarkers.js`); real IP from `X-Real-IP` or rightmost XFF hop only when the peer is loopback; `TRUST_LOOPBACK_AS_LOCAL=false` opt-out; localhost-only routes (`/api/oauth/*/auto-import`, `/api/auth/reset-password`, `/api/headroom/*`, `/api/pxpipe/*`) still 403 for remote.
- Bonus: `bun run dev` will now see real peer IPs, so the "everything is remote under `next dev`" caveat in CLAUDE.md disappears. Update CLAUDE.md.

### 6.4 Auth guard

`dashboardGuard.proxy(request)` logic (public paths, always-protected, require-login toggle, CLI token, API-key throttle) is preserved and runs before route dispatch, also for dashboard HTML routes (login redirect). Replace `NextResponse.redirect/next/json` with plain Responses; cookies read/written via `Bun.CookieMap` / `request.cookies` (Bun) or a small helper — keep cookie names, flags, `SameSite`, `Secure` behaviour identical. The 4 routes using `next/headers` (`auth/login`, `logout`, `status`, `locale`) move to the same helper.

### 6.5 Dashboard SPA

- Entry `index.html` imported into `Bun.serve` routes (`"/dashboard/*"`, `"/login"`, `"/callback"`, `"/"` → redirect to `/dashboard`). Bun bundles JSX/CSS; Tailwind v4 via `bun-plugin-tailwind` (bunfig for dev, `Bun.build` plugin for prod/compile).
- Client router: `next/navigation` (`useRouter`, `usePathname`, `useSearchParams`, `redirect`) and `next/link` replaced. *Designer's call: a tiny router library such as `wouter` (~2 KB) or an equivalent in-house hook; builder decides.* Keep URLs identical, including `/dashboard/providers/:id` and `/dashboard/settings/pricing`.
- `next/dynamic` → `React.lazy`; `next/image` → `<img>`; `next/font/google` → self-hosted IBM Plex Sans + JetBrains Mono (bundled woff2, same CSS variables `--font-plex`, `--font-jetbrains`); `@next/third-parties` GoogleAnalytics → plain script tag injected only when configured (same condition as today).
- Server-side data that pages got from the server (notably `getServerTimeZone()` in the dashboard layout, from T-43) must reach the SPA — via an API call at boot or values injected into `index.html` at serve time. Behaviour must match: one app timezone for server and UI.
- `metadata` (title, description, favicon, manifest from `src/app/manifest.js`) moves into `index.html` / a static manifest route.
- Pages that were server components (`page.js` without `"use client"`) become client components; no data fetching may move from server to a new unauthenticated endpoint.

### 6.6 Build & image

- Two build outputs from one `Bun.build` config: (a) a **JS bundle + assets** for the CLI package and `bun src/server/index.js`-style runs; (b) `bun build --compile --minify` executable with embedded SPA assets and `public/` files for Docker. Compile targets: `bun-linux-x64-musl` (Docker; add `bun-linux-arm64-musl` if a multi-arch image is published today — builder checks `docker-publish.yml`).
- Runtime files the executable must find on disk (provider icon manifest, catalog files, etc. — anything read via `fs` today) are either embedded or resolved relative to the executable; builder inventories these (`scripts/gen-provider-icon-manifest.mjs`, `scripts/copy-standalone-assets.mjs`).
- `open` package: today kept external because webpack baked `import.meta.url`. Verify it works inside the compiled executable (it spawns xdg-open/`start`), or replace with a small `Bun.spawn`-based opener.
- Dockerfile: Alpine base + `libstdc++ libgcc ca-certificates su-exec`, copy the musl executable, keep the non-root `node`→ (renamed or new) user, `/app/data` volume and entrypoint chown behaviour, same `PORT`/`HOSTNAME`/env contract, same healthcheck. `compose.production.yml`, `docker-compose.yml`, `captain-definition`, `start.sh` updated. Keep CA-bundle behaviour (`useSystemCaStore`) equivalent.
- Scripts: `dev` → `bun --hot src/server/index.js`; `build` → compile; `start` → run executable (or `bun src/server/index.js`). Node variants removed.

### 6.7 CLI → `literouter` (Bun package)

- Package renamed `9router` → **`literouter`**, bin `literouter`. **Bun-only**: installed with `bun add -g literouter` or run with `bunx literouter`. (Bun has no separate registry — it installs from the npm registry — so the package is still published to npmjs.com, but it declares Bun as its runtime: `#!/usr/bin/env bun` shebang, `engines.bun`, README install instructions use Bun.) *Owner's call (2026-11-22): move the CLI to Bun rather than keep a Node launcher.*
- The launcher itself runs on Bun. It ships the **bundled server JS + SPA assets** (output of `Bun.build`, a few MB), not compiled executables, and starts the server with the user's own Bun (`process.execPath` is `bun`). No per-platform packages.
- Same commands, flags, tray behaviour (Windows PowerShell NotifyIcon; `systray2` lazily installed on macOS/Linux into `~/.9router/runtime`), pidfile, self-heal. Node flags (`--max-old-space-size`, `--dns-result-order`) are dropped or mapped to Bun equivalents. Builder verifies `systray2` works when driven from Bun.
- Windows `EBUSY`: today's issue came from native `.node` files (better-sqlite3) locked in the global install dir. With `bun:sqlite` built in and only JS in the package, that cause goes away; builder confirms `bun add -g literouter` upgrades cleanly while the server is running.
- Minimum Bun version pinned (same one CI and Docker use).
- The old `9router` npm package gets a final release / `npm deprecate` message pointing to `literouter` — **publishing is an outward action; do it only with the owner's explicit go-ahead at release time.**

### 6.8 Tooling

- ESLint: drop `eslint-config-next`; flat config with `@eslint/js`, `eslint-plugin-react`, `eslint-plugin-react-hooks` (keep React Compiler rules as warnings, as today).
- Tests: **the whole suite moves to `bun test`** (`bun:test`). vitest, `tests/vitest.config.js` and the `node --test` `.cjs` tests are removed. *Owner's call (2026-11-22).*
  - Scope measured on `main`: 429 test files. They make 809 `vi.fn` calls and 329 `vi.mock` calls across 117 files. Other APIs used: `vi.resetModules` (88), `vi.hoisted` (52), `vi.useFakeTimers`/`setSystemTime`/`advanceTimersByTimeAsync` (~30 each), `vi.stubGlobal`/`stubEnv`, `vi.doMock`/`doUnmock`, `vi.importActual`, `vi.mocked`, `vi.waitFor`.
  - Map each one to `bun:test` (`mock`, `spyOn`, `mock.module`, `jest.useFakeTimers`, `setSystemTime`). Where Bun has no direct equivalent, refactor the test or the code it tests behind a small shared helper in `tests/helpers/`. This applies especially to `vi.resetModules`, `vi.hoisted` and the ordering of hoisted `vi.mock` calls.
  - **No test may be deleted or weakened** to make the migration pass. Each converted file keeps its test count and asserts the same things.
  - Path aliases (`@/`, `open-sse`) resolve through `jsconfig.json`/`tsconfig` paths, which Bun reads natively, or through `bunfig.toml`.
  - `verify-no-regression.mjs` and `known-fails.txt` are adapted to Bun's reporter output (e.g. `--reporter=junit`). Every baseline script runs with `bun`.
  - New server tests go in the same suite: route-table coverage, the auth guard, IP/trust, the body limit, timeouts/streaming, h2c, SPA fallback, static assets.
- CI: `oven-sh/setup-bun` with the pinned version; no `setup-node`. Steps: `bun install`, `bun test`, the baseline scripts, `bunx eslint .`, then a compile and Docker build with the image-size check.
- All repo scripts (`scripts/*.mjs`, `tests/__baseline__/*.mjs`) run under `bun`.
- `.github/workflows/{test,docker-publish,production-image}.yml` updated accordingly.

## 7. Working on `staging`

1. `staging` is a stale ancestor of `main` (692 commits behind, last touched 2026-09-20, no unique commits). Fast-forward it to `main` before starting.
2. Work lands on `staging` via PRs (same rig/auto-merge flow as `main`).
3. `main` keeps moving. Merge `main` → `staging` regularly (at least weekly and before each gate). Engine changes merge cleanly; changes to `src/app/api/**` or pages must be re-ported — the route-manifest test (§6.2) fails when `main` adds a route the Bun table lacks.
4. Cutover = merge `staging` → `main` after §8 gates pass, then production image switch.

Suggested phase order (builder plans details):
1. Sync + inventory (route manifest, page list, Next-import list, fs-read runtime files).
1b. **Move the test suite to `bun test` first, while the app code is still the Next version.** The suite then guards everything that follows, and running the engine's tests on Bun is the earliest way to find code that only works on Node (this is what §9.1 checks for). Any engine fix this needs is a runtime-neutral change that `main` can take too.
2. Bun server: route table, adapter, guard, IP/trust, timeouts, body limit, bootstrap, DB driver trim; port all API routes. Dashboard may be absent on `staging` during this phase.
3. Dashboard SPA port.
4. Compile targets, Dockerfile, CLI rename + executable delivery, CI.
5. Parity + perf gates, side-by-side staging deploy, cutover, delete remaining Next artefacts and docs references.

## 8. Cutover gates

- `bun test` suite: `verify-no-regression.mjs` green against the baseline; `tests/__baseline__/verify-*.mjs` green. The test count is ≥ the count on `main` at its last vitest baseline, plus the new server tests.
- No `node` binary needed anywhere: CI, Docker build, Docker runtime, CLI, scripts.
- **Differential check**: same recorded request fixtures sent to `main` (Node) and `staging` (Bun) — `/v1` chat/messages/responses (stream + non-stream, error cases) and every `/api` route — compare status, relevant headers, body/SSE framing. Prompt-cache-relevant upstream request bodies/headers byte-identical.
- Every dashboard page walked through (login, overview, providers list/new/detail incl. OAuth flows and `/callback`, combos, endpoint, quota, usage, console-log, systemone, token-saver, profile, settings/pricing) with no console errors.
- Trust model: tests for direct loopback (local), loopback + Caddy XFF (remote), spoofed XFF from remote, `TRUST_LOOPBACK_AS_LOCAL=false`, spoofed `x-9r-real-ip`.
- Image ≤ 150 MB; RSS idle and post-burst measured and below the re-measured `main` baseline.
- CLI: `bun add -g literouter` and `bunx literouter` on Windows, macOS, Linux; start, tray, stop, update-while-running (no EBUSY).
- Side-by-side deploy behind Caddy on a separate port/hostname before switching production; keep the last Node image tag and a DB backup for rollback (DB stays compatible both ways).

## 9. Decisions settled after builder review (designer's calls — owner may override)

1. **Upstream layer must work on Bun — in scope, verified first.** "`open-sse/` unchanged" means unchanged *behaviour*, not untouched code. Phase 1 starts with a **Bun-compat spike** over the Node-specific paths: `node:http2` duplex in `open-sse/executors/cursor.js`; `undici` `ProxyAgent`/`setGlobalDispatcher` in `open-sse/utils/proxyFetch.js` and `src/lib/network/proxyTest.js` (note: `setGlobalDispatcher` does **not** affect Bun's native `fetch` — outbound proxies likely need Bun's `fetch(url, { proxy })` or an explicit undici `fetch`); `open-sse/utils/zstdCompat.js`; any other `node:` APIs the spike finds. Each executor gets a Bun-run smoke test against a mock upstream (binary/protobuf/EventStream ones included). Prefer the Bun-native fix (e.g. Bun `fetch` `proxy` option over undici). Keep the `bun test` suite green.
2. **CLI on Bun end-to-end.** Self-update (`cli/cli.js` `INSTALL_CMD_LATEST`, today `npm i -g …`) becomes `bun add -g literouter@latest`; `cli/hooks/sqliteRuntime.js` (npm-installs sql.js/better-sqlite3) is deleted; `cli/hooks/trayRuntime.js` installs `systray2` with `bun add` into `~/.9router/runtime`. No `npm` shell-outs remain. The CLI's own tests (`cli/test`, `node --test`) move to `bun test`. The tray and the launcher are Bun-native: `Bun.spawn` instead of `child_process`, and `Bun.file` where it fits. CLI is its own workstream in phase 4 with its own acceptance list (§8). Pinned Bun = the version CI and the Docker build use (currently 1.4.x; pin an exact patch).
3. **DB compatibility contract.** The SQLite file is the contract both ways: same schema, same `user_version`/migrations table, same journal mode (WAL if WAL today) and pragmas set explicitly at open rather than relying on driver defaults. **Settings → Database export/import** (`src/lib/db/backup.js`, `src/app/api/settings/database/route.js`) must stay compatible both ways: an export from `main` imports into the Bun build and vice versa. Add fixture tests for both directions. sql.js usage there is re-implemented on `bun:sqlite`.
4. **Dashboard boot data.** The guard runs before `index.html` is served (unauthenticated HTML requests redirect to `/login` exactly as today). Server values the SPA needs (app timezone, GA id, require-login flag, locale) are **injected into `index.html` at serve time**, after the guard. No new endpoint. `/login` and `/callback` get only what they get today.
5. **arm64 is required.** `docker-publish.yml` already builds `linux/amd64,linux/arm64`, so compile `bun-linux-x64-musl` and `bun-linux-arm64-musl`. Both images must meet the ≤ 150 MB gate. Verify arm64 in CI via QEMU/buildx (smoke: start, `/api/health`, one mocked `/v1` call).
6. **Parity fixtures must be built.** No recorded corpus exists. Phase 1 builds a small **differential harness** early, before the route port: a mock upstream plus scripted requests (every `/api` route, `/v1` stream and non-stream, error cases). It runs against `main` (Node) to record expected outputs, then against `staging`. Credentials are stubbed with fixture DB rows; nothing calls real providers.
7. **Staging CI and release.** `docker-publish.yml` (tags `v*`) and `production-image.yml` (push to `main`) don't fire on `staging`, so production can't be deployed from it by accident. Keep it that way. Add a `staging` workflow that runs the full test and lint matrix and pushes `ghcr.io/…:staging-<sha>` for the side-by-side deploy. Branch protection on `staging` matches `main`.
8. **Old `9router` CLI users.** On first start, `literouter` reads the existing pidfile and port. If a server from the old Node CLI is running, it stops that server before starting (same data dir, so no state migration is needed). README and the final `9router` deprecation message say to run `npm rm -g 9router` and then `bun add -g literouter`. The CLI test matrix covers "old CLI server running → new CLI start".

## 10. Left to the builder

Exact directory layout; router library vs in-house hook; adapter/helper API shape; how the SPA gets server-side values; how runtime files are embedded; CLI bundle layout; CI job layout; ticket breakdown and ordering within phases.
