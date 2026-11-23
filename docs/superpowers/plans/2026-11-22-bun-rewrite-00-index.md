# Bun Rewrite: Plan Index and Cross-Plan Contract

Spec: `docs/superpowers/specs/2026-11-22-bun-rewrite-design.md`. All plans land on `staging` through PRs. The plans run **in order**, and each one assumes the previous plans are merged.

| # | Plan | Delivers |
|---|---|---|
| 1 | `2026-11-22-bun-rewrite-p1-test-suite.md` | The test suite on `bun test`; Bun-native outbound fetch; CI on Bun. The app is still Next, running on Bun |
| 2 | `2026-11-22-bun-rewrite-p2-server.md` | `Bun.serve` for every `/v1` and `/api` route, with the guard, IP/trust, timeouts, body limit, h2c, boot, gzip parity, `bun:sqlite` only, the Bun-native dependency swaps, per-executor smoke tests and the parity harness. The dashboard is a placeholder |
| 3 | `2026-11-22-bun-rewrite-p3-dashboard.md` | A React SPA built with `Bun.build` and Tailwind; all 16 pages ported; no `next/*` imports |
| 4 | `2026-11-22-bun-rewrite-p4-packaging.md` | Build and compile; Docker (amd64 and arm64, ≤150 MB); the `literouter` Bun CLI; CI and the staging image; ESLint without Next; Next and Node fully removed |
| 5 | `2026-11-22-bun-rewrite-p5-cutover.md` | Parity, performance and security gates; the CLI matrix; a soak; cutover to `main`; rollback; the release |

**Precedence:** where a plan's task text disagrees with this contract or with the "Reconciliation" block at the top of that plan, **this contract wins**. The reconciliation was done on 2026-11-23, after all five plans were written.

## Cross-plan contract

A plan that needs to change a name here must update this file in the same PR.

### Server (produced by Plan 2; consumed by Plans 3–5)

- **`src/server/index.js`**
  - `export async function startServer({ port = Number(process.env.PORT) || 20128, hostname = process.env.HOSTNAME || "0.0.0.0", routes = {} } = {}) → Promise<Server>`.
  - `routes` is a test hook that is merged over the generated table.
  - Under `import.meta.main`, the module calls `startServer()`, and calls `useSystemCaStore()` first when `LITEROUTER_SYSTEM_CA=1`.
  - **Fallback order:** route table, then SPA paths (`/`, `/login`, `/callback`, `/dashboard`, `/dashboard/*`) after the guard, through `serveSpa`, then `serveStatic`, then a 404. `/api/*` never reaches `serveStatic`.
- **`src/server/routes.js`**
  - `export const routeTable: Array<{ path: string, source: string, methods: string[], catchAll?: string, load: () => Promise<RouteModule> }>`.
  - The table is generated from `src/app/api/**/route.js`, and the drift test diffs it against the files.
  - **Rewrites are concrete aliases, one per target route**, for example `/v1/chat/completions` and `/v1/v1/chat/completions` → `api/v1/chat/completions`. They are not one wildcard entry, because Next rewrites each subpath to a different route.
  - `/codex` and `/codex/*` → `api/v1/responses`; `/responses` → `api/v1/responses`; `/v1beta/*` → `api/v1beta/*`.
- **`src/server/adapter.js`**
  - `export function toBunHandler(load, route = {}) → (req, server) => Promise<Response>`.
  - It dispatches on `req.method`. A missing method gets 405 **without** `Allow` (Next parity: its 405 carried none). When there's no `OPTIONS` export, OPTIONS gets 204 **with** `Allow`. When there's no `HEAD` export, HEAD runs `GET` and drops the body.
  - It calls the handler as `handler(req, { params: Promise.resolve(params) })`. Catch-all params are a `string[]` built from the URL, because Bun leaves `*` params empty.
  - `export function isLongLived(pathname) → boolean` → `server.timeout(req, 0)`.
- **`src/server/compress.js`**
  - `export async function maybeCompress(req, res) → Promise<Response>`.
  - It gzips every response with a compressible content type that is not SSE or ndjson and not a HEAD, 204, 206 or 304 response, when `Accept-Encoding` includes `gzip` (`q=0` refuses), and streams the compressed body. The only size rule is a *declared* `Content-Length` below 1 KiB, which is left as is; a response with no declared length is always compressed. The earlier "at least 1 KiB" rule was wrong: Next compresses small `/api` JSON too.
  - It never touches `text/event-stream`, `application/x-ndjson`, `Cache-Control: no-transform` responses or responses that already carry a `Content-Encoding`. A strong `ETag` becomes weak and `Vary: Accept-Encoding` is added.
  - *Owner-facing decision (2026-11-23): keep the gzip behaviour Next has. Direct LAN and CLI users don't sit behind Cloudflare.*
- **`src/server/http.js`**
  - `json(body, init?) → Response`. Its content type is `application/json;charset=utf-8`, because the goldens were recorded on Next running under Bun. Plan 5 compares against Node `main`, so any difference in this header is judged there.
  - `redirect(url, status = 307) → Response`
  - `nextUrl(req) → URL`
  - `cookies(req) → Bun.CookieMap`
  - `NextResponse.next()` in the guard becomes `null`.
- **`src/server/context.js`**
  - `setRequestContext(req, ctx)`
  - `getRequestContext(req) → { peerIp: string, clientIp: string, isLocal: boolean }`
  - It is backed by a `WeakMap`. A request without a context reads as `{ peerIp: "", clientIp: "", isLocal: false }`.
- **`src/server/trust.js`**
  - `isLoopbackAddress(addr) → boolean`
  - The client-IP rule: `X-Real-IP` or the rightmost XFF hop, and only when the peer is loopback. Proxy markers on a loopback peer mean the request is remote.
- **`src/server/guard.js`**
  - `export async function guard(req) → Promise<Response | null>`
  - `export function isLocalRequest(req) → boolean`
  - `src/dashboardGuard.js` is **moved** here, not wrapped.
- **`src/server/bodyLimit.js`**
  - `parseBodyLimit(raw) → number`. The default is 128 MB; over the limit the server returns 413.
- **`src/server/ca.js`**
  - `export function useSystemCaStore(tlsApi = tls, fetchHost = globalThis) → number`.
  - Plan 2 creates it, and Plan 4 Task 3 replaces the mechanism.
  - Bun's `fetch` ignores `tls.setDefaultCACertificates`, so Plan 4 wraps `fetch` with `tls.ca`. It fails closed on an empty store.
- **`src/server/boot.js`**
  - `export async function runBootOnce()` contains what `instrumentation.register()` did, plus `initOutboundProxy` and `initConsoleLogCapture`.
- **`src/server/paths.js`**
  - Plan 2 creates it with `PUBLIC_DIR`. Plan 3 adds `SPA_DIR`. Plan 4 adds `isBundled` and `assertBundleCwd`, and the bundled/compiled branches.

| | Source run | Bundled or compiled | Env override |
|---|---|---|---|
| `PUBLIC_DIR` | `<repo>/public` | `join(import.meta.dir, "public")` | `LITEROUTER_PUBLIC_DIR` |
| `SPA_DIR` | `<repo>/dist/web`, or a memoised dev build | `join(import.meta.dir, "web")` | `LITEROUTER_SPA_DIR` |

- **`src/server/spa.js`**
  - `export async function serveSpa(req) → Promise<Response>`.
  - It reads `index.html` (Plan 2 uses a placeholder at `src/web/index.html`; from Plan 3 on, `getSpa().indexHtml`).
  - An `HTMLRewriter` pass appends `<script>window.__LR_BOOT__=…</script>` and, from Plan 3 on, `headExtras(boot)` to `<head>`.
  - The boot JSON `\u`-escapes `<`, `>`, `&`, U+2028 and U+2029. The response carries `Cache-Control: no-store`.
  - Boot shape: `{ timeZone: string, gaId: string | null, requireLogin: boolean, locale: string }`.
- **`src/server/static.js`**
  - `export async function serveStatic(req) → Promise<Response | null>`. Plan 2 creates it, and Plan 3 *modifies* it to add `/assets/*`.
  - It handles GET and HEAD only.
  - `/assets/*` is served from `SPA_DIR` with `immutable` caching. Other paths are served from `PUBLIC_DIR`.
  - It is traversal-safe.
  - `/manifest.webmanifest` is the static file `public/manifest.webmanifest`, not a route.

### Dashboard (produced by Plan 3)

- **No HTML imports anywhere.** An imported `HTMLBundle` is opaque, so the boot data can't be injected into it after the guard. The SPA is built with `Bun.build` and served from disk, or from embedded files.
- **`src/web/build.js`**
  - `export async function buildWeb({ production, outdir }) → Promise<…>`.
  - It writes `index.html` and `assets/*`, with `publicPath: "/"` and `bun-plugin-tailwind`.
  - Production builds set `define: { "process.env.NODE_ENV": '"production"' }`.
  - `scripts/build-web.mjs` is the CLI for it.
- **Entry and shell:** `src/web/index.html` (no absolute URLs; icon, manifest and GA tags come from `head.js`), `src/web/main.jsx`, `src/web/App.jsx`.
- **`src/web/routes.js`:** `routes`, `findRoute(pathname)`. `/dashboard/settings/pricing` has `shell: false`.
- **Small modules:**
  - `src/web/boot.js`: `getBoot()`
  - `src/web/head.js`: `headExtras({ gaId })`
  - `src/web/router.js`: `useRouter()` (`push`, `replace`, `back`, `refresh`), `usePathname()`, `useSearchParams()`, `useParams()`, `<Link href>`, `redirect(href)`
- **`src/server/spaBuild.js`**
  - `getSpa() → Promise<{ dir, indexHtml }>`, `invalidateSpa()`.
  - It resolves through `SPA_DIR`. In production, a missing build throws.
- **Pages** live in `src/web/pages/**`. Shared components stay in `src/shared/components`.
- **Test dependencies:** `tests/package.json` gains `happy-dom` and `@happy-dom/global-registrator`.

### Build (produced by Plan 4)

- **`scripts/build.mjs`**
  - `buildApp({ outdir = "dist/app" })` runs `buildWeb({ production: true, outdir: <outdir>/web })` first. It then `Bun.build`s **only** the server entry, `src/server/index.js` → `<outdir>/index.js`, and copies `public/` → `<outdir>/public`.
  - `compileApp({ target })` produces `dist/bin/literouter-<target>`, embedding `public/` and `web/` so that `PUBLIC_DIR` and `SPA_DIR` resolve under `import.meta.dir`. Plan 4 verifies how `compile.assets` maps directory paths.
- **Compile targets:** `bun-linux-x64-musl` and `bun-linux-arm64-musl`.
- **Package scripts:**
  - `dev`: `bun --hot src/server/index.js`
  - `build`: `bun scripts/build.mjs`
  - `compile`, `compile:arm64`
  - `start`: `cd dist/app && bun index.js`
  - `lint`: `bun --bun run eslint .`
  - `test`
- **Staging image:** `ghcr.io/raufimusaddiq/literouter-staging:staging-<sha>`. The production deploy scripts accept only `ghcr.io/raufimusaddiq/literouter-production:production-<40 hex>`.
- **CLI:**
  - `cli/` stays at that path. The package is `literouter`, the bin is `literouter`, and it needs Bun ≥ 1.4.4.
  - It has a documented `stop` command, which Plan 5's matrix calls.
  - Publishing is owned by **Plan 5** and needs the owner's go-ahead.

### Unchanged names

`~/.9router`, `DATA_DIR`, every `NINEROUTER_*` env var, `x-9r-cli-token`, the cookie names, the DB schema and `user_version`, port 20128, the `PORT`/`HOSTNAME` env contract, `/app/data`, and uid/gid 1000 in the image.

### Tests and gates

- **Server tests:** `tests/server/*.test.js`. They start the app with `startServer({ port: 0, hostname: "127.0.0.1" })` and stop it with `server.stop(true)` in `afterAll`.
- **`tests/__baseline__/test-counts.json`:** the Plan 1 shape plus a `"waived": { "<file key>": "<replacement file> — <reason>" }` map, added by Plan 2 Task 1, and a `"deleted": { "<file> :: <full name>": "<reason>" }` map added by Plan 1 (a whole-file deletion uses `"<file> :: *"` and states `(N cases)` in its value). `files` stays at the frozen vitest counts; the gate subtracts one per deleted case from that file's expected count and requires a whole-file deletion to run 0 cases. A waived key passes the count gate only if its replacement file exists and has at least as many cases. A deleted entry passes only if its case no longer runs; `verify-test-counts.mjs` prints the deleted list on every run.
- **Skip gate:** `test-counts.json` also carries `"skipped": { "<file key>": n }`, the frozen vitest count of pending, skipped and todo cases per file (`record-test-counts.mjs` emits it), and `"skipWaivers": { "<file key>": "<reason>" }`, which starts empty. `verify-test-counts.mjs` fails when a file's junit skipped count exceeds its `skipped` entry (0 for a file with no entry). A waived file is exempt and the gate prints each waiver with its reason, so an entry needs a real one, for example "needs live credentials". Bun's junit emits an extra `(unnamed)` skipped case for a skipped `describe`; the gate ignores those.
- **Parity harness:** Plan 2 Task 1 builds it, and Plan 5 runs the final pass. It consists of:
  - `tests/parity/fixtures/*.json`
  - `tests/parity/mock-upstream.js`. It writes every upstream request it receives to `<outDir>/upstream-requests.jsonl`, one JSON object per line: `{ seq, method, path, headers: [[k, v], …] in wire order, bodyBase64 }`.
  - `tests/parity/seed.mjs <dataDir> --upstream <url> --print-key`. It seeds a data dir directly, without the dashboard API: it loads `tests/parity/fixtures/seed.json`, substitutes the upstream URL for `__UPSTREAM__`, and imports it with `importDb` into `DATA_DIR`. `--print-key` prints the first seeded API key.
  - `tests/parity/record.mjs <baseUrl> <outDir>`, `tests/parity/run.mjs --target next|bun --out <dir>`, `tests/parity/compare.mjs <expectedDir> <actualDir>`, `tests/parity/compare-upstream.mjs <expectedDir> <actualDir>`.
  - `tests/parity/known-diffs.json` lists every accepted response difference. Each entry names a `file` and a `path`, gives a `reason`, and pins the exact `actual` value or sets `absent: true` when the value is missing from the Bun output, so a different value is still reported. A listed diff that stops occurring is reported as stale and fails the run. `tests/parity/known-upstream-diffs.json` is the same for the upstream-request comparison, which is keyed per fixture (the requests each fixture caused, in order) rather than as one global sequence.
  - `tests/parity/runtime-header-allowlist.json`. It is short and reviewed. A Bun default header (`accept-encoding`, `user-agent`) that reaches an upstream gets **fixed in `open-sse/`**, not allowlisted, when it can affect prompt caching.
  - Recorded outputs are normalised and small, so Plan 5 can commit them as goldens in `tests/parity/expected/`.
- **Next-leftover gate:** `bun scripts/port-next-routes.mjs --check src/app/api src/server` must exit 0 (scope fixed in Plan 2 Task 14). The dashboard pages, layouts and components under `src/app/**/page.js`, `src/i18n` and `src/shared/components` still import `next/*` until Plan 3, so `--check src` is not yet clean. `bun scripts/gen-route-table.mjs --check` guards the route table against drift. CI runs both, then `tests/parity/run.mjs --target bun --out parity-actual`, `compare.mjs` and `compare-upstream.mjs` against `tests/parity/expected`; `parity-actual/` is git-ignored.
- **Cutover scripts:** `scripts/cutover/*`. They are defined by Plan 5.
- **ESLint** runs as `bunx --bun eslint .` or `bun --bun run eslint .`. A plain `bunx eslint` follows the `node` shebang.
