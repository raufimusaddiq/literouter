# Bun Rewrite — Plan 2: The Bun Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Next's server with one `Bun.serve` process that serves every `/v1` and `/api` route with the same observable behaviour, keeps the trust model, runs on `bun:sqlite` only, and drops the Node-era dependencies. The dashboard is a placeholder page until Plan 3.

**Architecture:** First build a differential harness (mock upstream, fixture DB, scripted requests) and record expected outputs from the *current* app. Then add the route manifest and generated route table, the HTTP primitives and adapter, the trust model and guard, the server entry with its transport behaviours, and port the 96 route files in three area groups with a re-runnable codemod, checking each group against the recorded outputs. Finish with the DB-driver trim, the dependency swaps, executor smoke tests, and deleting Next's server pieces.

**Tech Stack:** Bun 1.4.4 (`Bun.serve` routes, `Bun.CookieMap`, `HTMLRewriter`, `bun:sqlite`, `Bun.password`, `Bun.spawn`, `Bun.Transpiler`), `bun:test`, plain JS ESM.

**Spec:** `docs/superpowers/specs/2026-11-22-bun-rewrite-design.md` (§2.8, §4, §6.1–6.4, §9.1, §9.3, §9.4, §9.6). Cross-plan names: `docs/superpowers/plans/2026-11-22-bun-rewrite-00-index.md`. Assumes Plan 1 is merged (`bun test`, `import { vi } from "#test/vi"`, Bun-native outbound fetch, CI on Bun 1.4.4).

## Reconciliation (2026-11-23): this overrides the task text below

The index contract (`2026-11-22-bun-rewrite-00-index.md`) wins wherever it disagrees with this plan.

- **Compression is kept, not accepted as a known diff.** Task 3 also creates `src/server/compress.js`, which exports `maybeCompress(req, res)`, and the adapter applies it to every response. It gzips non-streaming responses with a compressible type that are 1 KiB or larger, and only when `Accept-Encoding` includes `gzip`. It never touches `text/event-stream` or a response that already has a `Content-Encoding`.
  - Add these tests: `"gzips a large JSON body when accepted"`, `"leaves SSE untouched"`, `"leaves small bodies untouched"`.
  - The parity comparison then expects `content-encoding` to match. Drop the "Task 8 asks the owner" note.
- **Task 6 also creates `src/server/paths.js`** with `PUBLIC_DIR`: `<repo>/public` by default, overridden by `LITEROUTER_PUBLIC_DIR`. `static.js` reads `PUBLIC_DIR` and never `process.cwd()`. Plans 3 and 4 extend this file.
- **Task 1's parity harness must also produce what Plan 5 needs:**
  - `mock-upstream.js` writes each request it receives to `<outDir>/upstream-requests.jsonl` as `{ seq, method, path, headers: [[k,v]…] in wire order, bodyBase64 }`.
  - `tests/parity/seed.mjs <dataDir> --upstream <url> --print-key` seeds the data dir without going through the dashboard API. Container peers are never loopback, so the API path can't be used there.
  - Recorded outputs are normalised and kept small enough to commit later as goldens.
- **The test-count waiver map.** Task 1 adds `"waived": { "<file key>": "<replacement file> — <reason>" }` to `test-counts.json`. It also teaches `verify-test-counts.mjs` to accept a waived key only when its replacement file exists and has at least as many cases.
- **Remove these imports:** `open`, `undici`, `bcryptjs`, `uuid`, `sql.js` and `better-sqlite3` must be gone from `src/` and `open-sse/` by the end of this plan. Plan 4 Task 14 tests for this.
- **Spec correction.** Settings → Database export/import is a JSON payload (`exportDb`/`importDb`) and never used sql.js. The spec's §9.3 has been corrected to say so. Task 11's fixtures follow the real code.

## Global Constraints

- Bun pinned to **1.4.4**. `Bun.serve` `idleTimeout` is in seconds, default 10, **max 255**.
- No change to env var names, `x-9r-cli-token`, cookie names (`auth_token`, `locale`), the DB schema and `user_version`, the data dir (`~/.9router`, `DATA_DIR`), or port 20128.
- The trust model does not weaken (§4): a request through Cloudflare → Caddy → loopback is **remote**; client `X-Forwarded-For` is untrusted except the rightmost hop (or `X-Real-IP`) from a loopback peer; `TRUST_LOOPBACK_AS_LOCAL=false` still works; localhost-only routes still 403 for remote callers.
- The `x-9r-peer-token` / `x-9r-real-ip` / `x-9r-via-proxy` mechanism is deleted and those headers are stripped if a client sends them.
- Body limit: `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE`, default **128 MB**, same parser as today, 413 above it.
- Streams must survive more than 15 s of silence (§4, §6.2).
- Nothing under `src/server/` or `src/app/api/` imports `next/*` when this plan ends.
- No test may be deleted or weakened (Plan 1 rule). Tests that exercised removed code (custom-server, peer token, deleted adapters) are rewritten to the equivalent new behaviour; each PR lists `old test → new test`. If a file's test count must drop, add it to `waived` in `tests/__baseline__/test-counts.json` with a reason (Task 1 adds that support).
- `staging` is **not deployable between Plans 2 and 4**: the Dockerfile and `cli/` still reference `custom-server.js` and `package-lock.json`, and are rebuilt in Plan 4. `package-lock.json` is left stale on purpose; `bun.lock` is authoritative.
- Plain JS ESM, no TypeScript. Conventional Commits; every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work lands on `staging` through PRs (rig auto-merge flow). Delegated work runs on **Sonnet 5.5**.

## Review Focus

1. **Cookie attributes.** Bun's `CookieMap` serialises differently from Next's `cookies()` (casing, `Expires`). The login cookie must keep `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=86400`, and `Secure` only behind `x-forwarded-proto: https` or `AUTH_COOKIE_SECURE=true`; logout must expire it on `Path=/`. Pinned in Task 8.
2. **Client disconnect.** `request.signal` must abort when the client drops mid-stream (the console-log and usage SSE routes only clean up on that signal; `/v1` aborts the upstream call). Pinned in Task 7.
3. **SIGTERM flush.** Buffered usage and request-detail rows must still reach SQLite on SIGTERM/SIGINT with the new server. Pinned in Task 7.
4. **IPv6 and IPv4-mapped peers.** `::1`, `::ffff:127.0.0.1` on a dual-stack `0.0.0.0` bind must read as loopback; a `::ffff:203.0.113.9` peer must not. Pinned in Task 4.
5. **Paths, methods and thrown errors.** Trailing slash (`/api/keys/`), percent-encoded params, `HEAD` and `OPTIONS` on handlers that export only `GET`, and a handler that throws or returns a non-`Response` must behave as Next did and must never crash the server. Pinned in Tasks 3 and 5.

---

## Facts this plan is built on (checked 2026-11-23 against `staging`, Bun 1.4.4)

- 96 `src/app/api/**/route.js` files; 27 handler functions in 16 of them take `{ params }`. Counts of what to port: `NextResponse.json` 441 in routes + 6 in `src/dashboardGuard.js` = 447; `NextResponse.redirect` 4 and `NextResponse.next` 7 (guard only); `new NextResponse(` 3 (`headroom/proxy/[...path]` ×2, `health`); `nextUrl` 3 in routes (`v1/models/route.js` ×2, `v1/models/[...model]`) + 3 in the guard; `export const dynamic` 28 in routes (the other 2 are in `(dashboard)/layout.js` and a page, Plan 3), `maxDuration` 2 (`pxpipe/install`, `pxpipe/start`), and `export const revalidate` 1 (`settings`). `next/headers` is used by `auth/login`, `auth/logout`, `auth/status`, `locale`.
- Dynamic dirs: `combos/[id]`, `keys/[id]`, `oauth/[provider]/[action]`, `provider-nodes/[id]`, `providers/[id]` (+ `/models`, `/test`, `/test-models`), `proxy-pools/[id]` (+ `/test`), `usage/[connectionId]` (+ `/codex-reset-credits`), `v1/models/[kind]`, and catch-alls `headroom/proxy/[...path]`, `v1/models/[...model]`, `v1beta/models/[...path]`.
- Probed on Bun 1.4.4: `routes` params arrive percent-decoded; a `/x/*` wildcard leaves `req.params` empty (derive segments from the URL); `/v1/*` does not match `/v1`; a more specific pattern (`:kind`, `/v1/v1/*`) wins over a wildcard; `req.cookies.set(...)` is applied to the returned `Response` automatically; `server.requestIP(req)` returns `{address, family, port}`; `maxRequestBodySize` yields 413; an `Upgrade: h2c` POST gets a normal HTTP/1.1 200.
- `Bun.password.verify` reads `$2a$`/`$2b$` hashes written by bcryptjs, **but** for passwords longer than 72 bytes it SHA-512-prehashes, so an 80-byte password hashed by bcryptjs verifies `false`. Verifying the first 72 bytes instead returns `true`, and a hash made from the first 72 bytes verifies under bcryptjs. `Bun.password.verify` **throws** on a non-bcrypt/argon string where bcryptjs returned `false`.
- `Settings → Database` export/import is a **JSON payload** (`exportDb`/`importDb` in `src/lib/db/index.js`), not a SQLite file. `backupDbLite` (`src/lib/db/backup.js`, an `ATTACH` copy before a schema migration) is the only SQLite-file backup and has no restore path. `sql.js` appears only as a driver adapter.
- Pragmas are already explicit (`PRAGMA_SQL` in `src/lib/db/schema.js`): `journal_mode=WAL`, `synchronous=NORMAL`, `temp_store=MEMORY`, `mmap_size=30000000`, `cache_size=-16000`, `wal_autocheckpoint=1000`, `foreign_keys=ON`, `busy_timeout=5000`.
- `x-9r-real-ip` is the *effective* client IP (loopback proxy hop → `X-Real-IP` or rightmost XFF). It feeds `isLocalRequest`, `throttleKey` (API-key throttle) and `loginLimiter.getClientIp`. Callers of `isLocalRequest`: `auth/login`, `provider-nodes` (POST), `provider-nodes/validate`, `providers/validate`.
- `custom-server.js` also holds the system-CA swap (`useSystemCaStore`, enabled by `LITEROUTER_SYSTEM_CA=1`, fails closed) and the h2c downgrade (411 for chunked, 413 over the cap, 120 s read timeout).
- `open-sse/shared/machineId.js` calls `machineIdSync()` on every process start and feeds upstream identity (Kiro/Qoder); `src/shared/utils/machineId.js` persists it to `DATA_DIR/machine-id`; `cli/src/cli/api/client.js` derives the CLI token from the same file.

---

### Task 1: Differential parity harness, recorded from the current app

Built first, against the code as it is on `staging` today (Next on Bun, Plan 1's interim). Nothing in `src/` changes in this task.

**Files:**
- Create: `tests/parity/mock-upstream.js`, `tests/parity/normalize.js`, `tests/parity/seed.mjs`, `tests/parity/record.mjs`, `tests/parity/compare.mjs`, `tests/parity/run.mjs`
- Create: `tests/parity/fixtures/seed.json` (an `importDb` payload with an `__UPSTREAM__` placeholder), `tests/parity/fixtures/*.json` (request scripts), `tests/parity/known-diffs.json` (starts as `[]`)
- Create: `tests/parity/expected/` (recorded outputs, committed)
- Create: `tests/parity/harness.test.js`
- Modify: `tests/__baseline__/verify-test-counts.mjs` (honour a `waived` map)

**Interfaces:**
- Produces (contract, Plan 5 reuses): `bun tests/parity/record.mjs <baseUrl> <outDir>`, `bun tests/parity/compare.mjs <expectedDir> <actualDir>` (exit 1 on any diff not listed in `known-diffs.json`; a listed diff that no longer occurs also fails), `tests/parity/mock-upstream.js`, `tests/parity/fixtures/*.json`.
- `startMockUpstream({ port = 0 } = {}) → Promise<{ url: string, requests: RecordedRequest[], reset(): void, stop(): Promise<void> }>`. `RecordedRequest = { method, path, headers: Record<string,string>, body: string }`. Scenario is picked by the request body `model`: `mock-ok`, `mock-stream`, `mock-429`, `mock-500`, `mock-bad-json`, `mock-truncated-stream`, `mock-slow-stream` (pauses `MOCK_STREAM_PAUSE_MS`, default 16000, after the first chunk). Endpoints: `POST /v1/chat/completions`, `GET /v1/models`, `POST /v1/messages`.
- `run.mjs --target next|bun --out <dir> [--only <fixture-id-prefix>]`: creates a temp `DATA_DIR`, writes `machine-id` and `auth/cli-secret` files with fixed contents (so the CLI token is deterministic), runs `seed.mjs`, starts the mock upstream, spawns the target (`next`: `bun .next/standalone/custom-server.js`; `bun`: `bun src/server/index.js`) with fixed `JWT_SECRET`, `API_KEY_SECRET`, `MACHINE_ID_SALT`, `INITIAL_PASSWORD`, `TZ=Asia/Jakarta`, waits for `/api/health`, runs `record.mjs`, stops everything.
- Fixture schema: `{ "id": string, "peer": "loopback"|"proxied"|"lan", "auth": "none"|"cli"|"apikey"|"session", "method", "path", "headers"?, "json"?|"body"?, "sse"?: { "maxFrames": number, "maxMs": number } }`. `proxied` adds `X-Forwarded-For: 203.0.113.9` and `X-Forwarded-Proto: https` (the Caddy case); `lan` connects through the machine's first non-internal IPv4 address (a genuinely remote TCP peer; the fixture is skipped if there is none). Fixtures run in filename order, so the throttle and lockout fixtures are named `zz-*` and run last.
- Normalised output per fixture, in `<outDir>/<id>.json`: `{ status, headers (allowlist: content-type, cache-control, access-control-*, location, retry-after, allow, set-cookie attributes with the value masked, www-authenticate, x-accel-buffering), body | frames, upstream: RecordedRequest[] }`. `normalize.js` masks ISO timestamps, epoch ms, UUIDs, `chatcmpl-*`/`msg_*` ids and JWTs. Upstream request headers are compared as a sorted map and bodies byte for byte.

- [ ] **Step 1: Write the failing tests** in `tests/parity/harness.test.js`:
  - `"mock upstream replays each scenario"`: `mock-ok` returns 200 JSON, `mock-stream` returns frames ending in `data: [DONE]`, `mock-429` returns 429 with `retry-after`, `mock-truncated-stream` closes before `[DONE]`; every call lands in `requests` with its raw body.
  - `"normalize masks volatile values and keeps structure"`: ISO date, `1763800000000`, a UUID, a JWT and `chatcmpl-abc` become stable tokens; key order and other values are unchanged.
  - `"normalizeSse splits frames and keeps comment lines"`: `": keepalive\n\ndata: {\"a\":1}\n\n"` → two frames.
  - `"compare reports path, expected and actual"` and `"compare fails on a stale known-diff"`.
  - `"fixture coverage"`: the fixtures plus the `skip` map in `fixtures/coverage.json` cover every `src/app/api/**/route.js` (by its path). A skip needs a `reason`. Allowed skips are only the *success* path of routes that need a real provider or spawn a process (`oauth/*` exchanges, `headroom/*`, `pxpipe/*`, `proxy-pools/netlify-deploy`, `providers/validate` against real hosts); the guard behaviour of those routes (401/403 for `proxied` and `lan`) is still a fixture.
- [ ] **Step 2:** Run `cd tests && bun test parity/harness.test.js`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement `mock-upstream.js`, `normalize.js` (`normalizeBody(value)`, `normalizeHeaders(headers)`, `normalizeSse(text) → Array<{event?, data, comment?}>`), `compare.mjs`, `seed.mjs`. `seed.mjs <dataDir> <upstreamUrl>` loads `seed.json` through `importDb` (same code both targets use): one OpenAI-compatible provider node pointing at the mock, one API-key connection, a combo `parity-combo` (`mock-429` → `mock-ok`), a model alias, an API key whose `key` is fixed (`sk-parity-valid`), and `settings.password` set to a **bcryptjs `$2b$` hash of `parity-pass`** (also used by Task 12) with `requireLogin: true`.
- [ ] **Step 4:** Write the fixtures. Groups (ids prefixed): `v1-*` (chat completions stream and non-stream, upstream 429 → combo fallback, upstream 500, bad JSON, truncated stream, unknown model, `/v1/messages` in Anthropic shape, `/v1/responses`, `/v1/models`, `/v1/v1/chat/completions`, `/codex/responses`, `/responses`, `/v1beta/models`, the same `/v1` route with each of `loopback`, `proxied`, `lan` and with no key / wrong key / valid key / CLI token), `api-*` (every route that is not skipped, GET plus the mutating methods it exports, with `session` or `cli` auth, a missing-auth variant, and a 404 for an unknown `/api/nope`), `trust-*` (`/api/headroom/start`, `/api/auth/reset-password`, `/api/oauth/kiro/auto-import` from `loopback` with CLI token = allowed, from `proxied` and `lan` = 403), `edge-*` (`OPTIONS` and `HEAD` on a `GET`-only route, `/api/keys/` with a trailing slash, `/api/keys/a%20b`, two SSE routes with `sse.maxMs: 1500`), `zz-*` (repeated wrong API keys from one `lan` peer until `429`, repeated wrong dashboard password until `429`).
- [ ] **Step 5:** Implement `record.mjs` and `run.mjs`. Run `bun tests/parity/run.mjs --target next --out tests/parity/expected` after `bun run build:bun`. Expected: one JSON file per fixture, exit 0. Run it a second time into `tmp-parity` and `bun tests/parity/compare.mjs tests/parity/expected tmp-parity`. Expected: **0 diffs** (proves the recording is deterministic; fix normalisers until it is).
- [ ] **Step 6:** Run `cd tests && bun test parity/harness.test.js`. Expected: PASS. Add `waived` support to `verify-test-counts.mjs` (`{ "<file>": { "to": n, "reason": "..." } }`) with a unit test in `tests/unit/baseline-junit.test.js`.
- [ ] **Step 7:** Commit: `test(parity): differential harness and recorded outputs from the Next build`.

### Task 2: Route manifest, generated route table, drift test

**Files:**
- Create: `scripts/gen-route-table.mjs`, `src/server/routes.js` (generated), `tests/server/route-table.test.js`, `tests/server/fixtures/next-rewrites.json`
- Modify: `package.json` (script `gen:routes`)

**Interfaces:**
- Produces: `routeTable` exactly as the index specifies, with two additions: an entry may carry `catchAll?: string` (the param name for a `*` segment) and `methods: string[]` (the HTTP verbs the module exports). Aliases for the `next.config.mjs` rewrites are **concrete** entries, one per route module (a wildcard cannot pick a module): every `/api/v1/**` route also appears as `/v1/**` and `/v1/v1/**`, every `/api/v1beta/**` route as `/v1beta/**`, plus `/v1`, `/v1/v1`, `/v1beta`, `/codex` and `/codex/*` and `/responses` all pointing at `api/v1/responses` (`/codex/:path*` matches `/codex` itself, so both patterns are needed).
- `scanApiRoutes(root = "src/app/api") → Array<{ source: string, path: string, methods: string[], catchAll?: string }>` (exported from `scripts/gen-route-table.mjs`). Methods come from `new Bun.Transpiler({ loader: "js" }).scan(code).exports` intersected with `GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD`. `[x]` → `:x`, `[...x]` → `*` with `catchAll: "x"`.
- `expandRewrites(rewrites, routes) → Array<{ path, source }>`. `tests/server/fixtures/next-rewrites.json` is a snapshot of `next.config.mjs`'s `rewrites()` taken now (the file loses its rewrites in Task 14); a `main` → `staging` merge conflict on `next.config.mjs` is the cue to refresh it.
- CLI: `bun scripts/gen-route-table.mjs [--check]`; `--check` exits 1 when `src/server/routes.js` differs from the scan.

- [ ] **Step 1: Write the failing tests** in `tests/server/route-table.test.js`:
  - `"every route.js is in routeTable"`: scan `src/app/api`, expect one entry per file with matching `source`.
  - `"every entry's source exists and its module exports a handler for each listed method"`: dynamically `load()` is **not** called; use the scan result.
  - `"rewrites are covered"`: with `next-rewrites.json`, `/v1/chat/completions`, `/v1/v1/chat/completions`, `/v1beta/models`, `/v1/models/:kind`, `/v1/models/*`, `/codex`, `/codex/*`, `/responses` are present and point at the right `source`.
  - `"no duplicate path+source pairs; static beats param beats wildcard"`: assert the three catch-all/param collisions behave (`/api/v1/models/info` static, `/api/v1/models/:kind`, `/api/v1/models/*`).
  - `"scanApiRoutes reads a temp tree"`: a fixture tree with `[id]`, `[...rest]` and a file exporting `GET` and `POST` only.
- [ ] **Step 2:** Run `cd tests && bun test server/route-table.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement the generator; `load` is `() => import("<relative path to route.js>")` (static string, so Bun's bundler can embed it later). Run `bun scripts/gen-route-table.mjs` to write `src/server/routes.js` with a "generated, do not edit" header.
- [ ] **Step 4:** Run the test. Expected: PASS. Run `bun scripts/gen-route-table.mjs --check`. Expected: exit 0.
- [ ] **Step 5:** Commit: `feat(server): route manifest generator, generated route table and drift test`.

### Task 3: HTTP primitives, request context, route adapter

**Files:**
- Create: `src/server/http.js`, `src/server/context.js`, `src/server/adapter.js`
- Test: `tests/server/http.test.js`, `tests/server/adapter.test.js`

**Interfaces:**
- `src/server/http.js` (contract): `json(body, init?) → Response` (same result as `NextResponse.json`), `redirect(url, status = 307) → Response` (`Location` is the resolved absolute URL), `nextUrl(req) → URL`. **Addition:** `cookies(req) → Bun.CookieMap` returns `req.cookies` (changes are written to the response by Bun); for a plain `Request` it returns a `CookieMap` parsed from the `Cookie` header.
- `src/server/context.js`: `setRequestContext(req, ctx)`, `getRequestContext(req) → { peerIp: string, clientIp: string, isLocal: boolean }`. **Addition:** `clientIp` is the effective client IP (see Task 4). A request with no context reads as `{ peerIp: "", clientIp: "", isLocal: false }`.
- `src/server/adapter.js`: `toBunHandler(load, route = {}) → (req, server) => Promise<Response>`. `route` is the `routeTable` entry (needed for `catchAll` and the static prefix). Behaviour: memoises `load()`; picks the export for `req.method`; no export → `405` with an `Allow` header; no `OPTIONS` export → `204` with `Allow` (as Next does); no `HEAD` export but `GET` → run `GET`, drop the body; params = `req.params` for named segments, and for `catchAll` the URL path after the route's static prefix split on `/` and `decodeURIComponent`ed into `string[]`; calls `handler(req, { params: Promise.resolve(params) })`; a throw or a non-`Response` return → log and `500` with an empty body; applies `server.timeout(req, 0)` for paths matching `isLongLived(pathname)` (below).
- `isLongLived(pathname) → boolean` (exported from `adapter.js`): `/v1*`, `/v1beta*`, `/codex*`, `/responses`, `/api/v1*`, `/api/v1beta*`, `/api/console-logs/stream`, `/api/usage/stream`, `/api/pxpipe/install`, `/api/pxpipe/start` (the two `maxDuration = 300` routes).

- [ ] **Step 1: Write the failing tests.**
  - `http.test.js`: `"json matches NextResponse.json"` (status, `content-type: application/json`, body, custom headers); `"redirect resolves a relative target and defaults to 307"`; `"nextUrl returns the parsed URL with searchParams"`; `"cookies reads the Cookie header and, on a Bun request, sets Set-Cookie"` (start a throwaway `Bun.serve`).
  - `adapter.test.js` (throwaway `Bun.serve({ routes })` with fake modules): `"params arrive as a Promise of decoded strings"` (`/k/a%20b` → `"a b"`); `"catch-all params are a string[]"` (`/m/a/b%20c` → `["a","b c"]`); `"405 with Allow for a missing method"`; `"auto OPTIONS returns 204 with Allow"`; `"HEAD runs GET and drops the body"`; `"a throwing handler returns 500 and the server keeps serving"`; `"a handler returning undefined returns 500"`; `"long-lived paths call server.timeout(req, 0), others do not"` (spy on a fake `server`); `"cookies set on req.cookies reach the client"`.
- [ ] **Step 2:** Run `cd tests && bun test server/http.test.js server/adapter.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement the three modules.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(server): http helpers, request context and route adapter`.

### Task 4: Trust model and guard

**Files:**
- Create: `src/server/trust.js`, `src/server/guard.js` (moved from `src/dashboardGuard.js` with `git mv`)
- Modify: `src/lib/auth/loginLimiter.js`, `src/app/api/auth/login/route.js`, `src/app/api/provider-nodes/route.js`, `src/app/api/provider-nodes/validate/route.js`, `src/app/api/providers/validate/route.js` (import `isLocalRequest` from `@/server/guard.js`)
- Delete: `src/lib/auth/trustedPeer.js`
- Modify tests: `tests/unit/dashboard-guard.test.js`, `tests/unit/local-request-peer-trust-3294.test.js`, `tests/unit/key-hardening.test.js`, `tests/unit/provider-validate-ssrf.test.js`, `tests/unit/minimal-profile-boundary.test.js`
- Create: `tests/server/trust.test.js`

**Interfaces:**
- `src/server/trust.js`: `isLoopbackAddress(addr: string) → boolean` (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`, `localhost`, bracketed forms: the old `isLoopbackHostname` rule); `deriveClientIp(peerIp: string, headers: Headers) → string` (loopback peer with `X-Real-IP` or a rightmost `X-Forwarded-For` hop → that hop, else `peerIp`); `buildRequestContext(peerIp: string, headers: Headers) → { peerIp, clientIp, isLocal }` where `isLocal` is true only if: `trustLoopbackAsLocal()`, `!hasProxyMarker(headers)` (from `src/lib/auth/proxyMarkers.js`, unchanged), `isLoopbackAddress(peerIp)`, and `Origin`, when present, is a loopback host.
- `src/server/guard.js`: `export async function guard(req) → Promise<Response | null>` (the old `proxy`; `NextResponse.next()` → `null`, `.json/.redirect` → `json/redirect`, `request.nextUrl` → `nextUrl(request)`, `request.cookies.get` → `cookies(request).get`), `export function isLocalRequest(req) → getRequestContext(req).isLocal`, `__test__` as before. `throttleKey` and `loginLimiter.getClientIp` return `getRequestContext(req).clientIp` (loginLimiter keeps its `TRUST_PROXY` and `"unknown"` fallbacks for a request without a context).
- The `/` → `/dashboard` redirect, `MINIMAL_PROFILE` handling, public/always-protected/local-only lists and the CLI-token check are copied unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/server/trust.test.js` (pure functions plus one real-socket suite using `startServer` from Task 5 once it exists; until then the socket suite is added in Task 5's step 1):
  - `isLoopbackAddress`: true for the five forms above; false for `127.0.0.2`, `::ffff:203.0.113.9`, `""`.
  - `deriveClientIp`: loopback peer + `X-Forwarded-For: 198.51.100.7, 203.0.113.9` → `203.0.113.9` (rightmost); `X-Real-IP` wins over XFF; a **non-loopback** peer ignores both and keeps its own address; `::ffff:127.0.0.1` counts as a loopback proxy.
  - `buildRequestContext`: direct loopback → `isLocal: true`; loopback + `X-Forwarded-For` → `false`; loopback + each of the 8 `PROXY_MARKER_HEADERS` → `false`; loopback with `TRUST_LOOPBACK_AS_LOCAL=false` → `false`; loopback + `Origin: https://evil.example` → `false`; non-loopback peer → `false` even if `Host: localhost`.
  - Port the guard tests: every existing case in `dashboard-guard.test.js` keeps its name and assertions, with requests built by a helper that calls `setRequestContext(req, buildRequestContext(peer, req.headers))` instead of setting `x-9r-*` headers, and `NextResponse.next()` assertions becoming `expect(result).toBeNull()`. `local-request-peer-trust-3294.test.js` keeps its 13 tests: the four that were about the peer token ("no trust proof", "wrong token", "wrapper never booted", "stamped by the wrapper") become `"a request without a server context is never local"`, `"a context built from a non-loopback peer is never local"`, `"a spoofed x-9r-real-ip header is ignored"`, `"a context from a real loopback peer is local"`.
- [ ] **Step 2:** Run `cd tests && bun test server/trust.test.js unit/dashboard-guard.test.js unit/local-request-peer-trust-3294.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement `trust.js`; `git mv src/dashboardGuard.js src/server/guard.js` and rewrite it per the interface; update the five importers, `loginLimiter.js` and the tests; delete `trustedPeer.js`.
- [ ] **Step 4:** Run the same command, then `cd tests && bun test unit/login-lockout.test.js unit/login-limiter-begin-attempt.test.js unit/key-hardening.test.js unit/provider-validate-ssrf.test.js unit/minimal-profile-boundary.test.js`. Expected: PASS, counts ≥ baseline.
- [ ] **Step 5:** Commit: `feat(server): request-context trust model and guard without peer-token headers`.

### Task 5: Server entry, boot, error handling

**Files:**
- Create: `src/server/index.js`, `src/server/boot.js`
- Modify: `src/app/layout.js` (remove the three server-side lines: `initOutboundProxy`, `bootstrap`, `initConsoleLogCapture`)
- Test: `tests/server/serve.test.js`, `tests/server/boot.test.js`

**Interfaces:**
- `startServer({ port, hostname, routes: extra = {} } = {}) → Promise<Server>` (contract; `routes` is an additive test hook merged over the generated table). Awaits `runBootOnce()`, then `Bun.serve({ port, hostname, idleTimeout: 255, maxRequestBodySize, routes, fetch, error })`. Every route handler and the `fetch` fallback run `serve(req, server, inner)`: build and `setRequestContext(req, buildRequestContext(server.requestIP(req)?.address ?? "", req.headers))`, then delete `x-9r-real-ip`, `x-9r-peer-token`, `x-9r-via-proxy` and `x-forwarded-for` from `req.headers` (the old wrapper removed them too), then `guard(req)`; a non-null guard result is returned as is, else `inner`. Each `routeTable` entry registers `toBunHandler(load, entry)`.
- `fetch` fallback: `/api/*` → `json(<404 body recorded in Task 1>, { status: 404 })`; GET under `/dashboard`, `/login`, `/callback` → `serveSpa(req)` (Task 6); static files (Task 6); else a plain 404.
- `runBootOnce() → Promise<void>` in `src/server/boot.js`: the body of `src/instrumentation.js`'s `register()` (`warnIfWeakApiKeySecret`, `initConsoleLogCapture`, `installCatalogSource`, `startModelCatalogSync`, import of `@/shared/services/bootstrap.js`) plus `import("@/lib/network/initOutboundProxy")` (which defers itself with `setImmediate`). One shared promise on `globalThis.__lrBoot` makes it run once per process, including under `bun --hot` and concurrent calls. Under `--hot`, `startServer` reuses `globalThis.__lrServer` via `server.reload(...)`.
- When `import.meta.main`, the file calls `startServer()` and logs the listen address.

- [ ] **Step 1: Write the failing tests.**
  - `boot.test.js` (module mocks for the five collaborators): `"runBootOnce runs each step exactly once across repeated and concurrent calls"`; `"a failing step does not prevent the others, and is logged"`.
  - `serve.test.js` (`startServer({ port: 0, hostname: "127.0.0.1" })`, `server.stop(true)` in `afterAll`): `"serves a /api route through the guard"`; `"unauthenticated /api/settings is 401"`; `"every routeTable path answers (not a Bun 404) for its first method"` (using `routeTable`; a 401/403 is fine); `"unknown /api path returns the recorded 404 JSON"`; `"trailing slash /api/keys/ behaves like the recorded Next response"`; `"a handler that throws returns 500 and the next request still works"`; `"x-9r-* and x-forwarded-for are stripped before handlers"` (extra route echoing `req.headers`); `"startServer twice in one process boots once"`; and the real-socket trust suite: direct loopback with a CLI token to `/api/auth/reset-password` is allowed, the same with `X-Forwarded-For` is 403, spoofed `x-9r-real-ip: 127.0.0.1` from a non-loopback peer is still 403 (skip when the box has no non-loopback IPv4), `TRUST_LOOPBACK_AS_LOCAL=false` makes loopback remote.
  - Port of `custom-server-peer-headers.test.js` (7 tests → `tests/server/peer-headers.test.js`): `"startServer leaves NINEROUTER_PEER_TOKEN unset"`; `"strips a client-sent x-9r-real-ip"`; `"does not stamp x-9r-peer-token or x-9r-real-ip"`; `"strips a client-sent x-9r-peer-token"`; `"strips a client-sent x-9r-via-proxy"`; `"loopback proxy hop: context.clientIp is the rightmost XFF hop and isLocal is false"`; `"keeps the peer token out of persisted request details"` (unchanged assertion).
- [ ] **Step 2:** Run `cd tests && bun test server/serve.test.js server/boot.test.js server/peer-headers.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement `index.js` and `boot.js`; remove the layout lines. Routes not yet ported still import `next/server`; `NextResponse.json` works outside Next, so they serve. The four `next/headers` routes will fail until Task 8, which is expected.
- [ ] **Step 4:** Run the same command. Expected: PASS except the cookie-route cases, which Task 8 covers. Then `bun tests/parity/run.mjs --target bun --out tmp-parity` and `bun tests/parity/compare.mjs tests/parity/expected tmp-parity`; record the output, which becomes the work list for Tasks 8–10 (`known-diffs.json` stays empty).
- [ ] **Step 5:** Commit: `feat(server): Bun.serve entry, guard dispatch and boot`.

### Task 6: SPA placeholder, static files, manifest

**Files:**
- Create: `src/server/spa.js`, `src/server/static.js`, `src/web/index.html`, `public/manifest.webmanifest`
- Delete: `src/app/manifest.js`
- Test: `tests/server/spa.test.js`

**Interfaces:**
- `serveSpa(req) → Promise<Response>` (contract). Reads `src/web/index.html` with `Bun.file`, injects `<script>window.__LR_BOOT__ = {...}</script>` as the last child of `<head>` with `HTMLRewriter`. Boot: `{ timeZone: getServerTimeZone(), gaId: process.env.NEXT_PUBLIC_GA_ID || null, requireLogin: settings.requireLogin !== false, locale: normalizeLocale(<locale cookie>) }`. The JSON is escaped (`<` → `<`, ` `, ` `). `Cache-Control: no-store`.
- `serveStatic(req) → Promise<Response | null>`: serves files under `public/` (no directory listing, no path traversal, correct content type, `Cache-Control` as Next sent for `public/`), `null` when absent.
- `src/web/index.html`: a minimal page ("Dashboard is being ported") that Plan 3 replaces; keep `<head>` and `<div id="root">`.
- `public/manifest.webmanifest` carries the data from `src/app/manifest.js` with `content-type: application/manifest+json`.

- [ ] **Step 1: Write the failing tests** (`startServer`, `requireLogin` toggled through `updateSettings`): `"unauthenticated /dashboard redirects to /login"`; `"/ redirects to /dashboard"`; `"/login and /callback serve the SPA without a session"`; `"/dashboard/providers/abc serves index.html after login"` (cookie from `/api/auth/login`); `"boot values are injected: timeZone, gaId, requireLogin, locale"`; `"a hostile locale cookie cannot break out of the script tag"` (`</script><script>alert(1)`); `"public files are served and ../ traversal is 404"` (`/favicon.svg`, `/icons/icon-192.svg`, `/%2e%2e/package.json`); `"/manifest.webmanifest has the manifest content type"`; `"unknown non-dashboard path is 404"`.
- [ ] **Step 2:** Run `cd tests && bun test server/spa.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement `spa.js`, `static.js`, wire both into `index.js`'s fallback; move the manifest data.
- [ ] **Step 4:** Run the test. Expected: PASS. Run `bun tests/parity/run.mjs --target bun --only edge --out tmp-parity` and compare the `edge-*` fixtures.
- [ ] **Step 5:** Commit: `feat(server): SPA placeholder with boot injection, static files and manifest`.

### Task 7: Transport behaviour: timeouts, body limit, h2c, disconnects, shutdown, CA store

**Files:**
- Create: `src/server/bodyLimit.js`, `src/server/ca.js`
- Modify: `src/server/index.js`
- Create: `tests/server/{body-limit,timeouts,h2c,disconnect,shutdown,ca}.test.js`
- Delete: `tests/unit/custom-server-h2c.test.js` (its 3 tests move to `h2c.test.js`), the `useSystemCaStore` cases of `tests/unit/system-ca-trust.test.js` move to `ca.test.js` (same count)

**Interfaces:**
- `parseBodyLimit(raw: string | undefined) → number`: same rule as `custom-server.js` (`b|kb|mb|gb`, decimals, invalid → 128 MiB).
- `src/server/ca.js`: `useSystemCaStore() → number`: the mechanism Plan 1 Task 8 found for Bun (system CA store honoured by `fetch`/TLS); when `LITEROUTER_SYSTEM_CA=1` and no usable system store exists, `startServer` logs the error and exits 1 (fails closed, as today).

- [ ] **Step 1: Write the failing tests.**
  - `body-limit.test.js`: `parseBodyLimit` table (`"128mb"` → 134217728, `"1kb"`, `"1.5gb"`, `"abc"` → 134217728, `undefined` → default); with `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE=1kb`, a 900-byte POST reaches the handler, a 2 KB POST with `Content-Length` and a 2 KB **chunked** POST both get `413`.
  - `timeouts.test.js` (every test above 5000 ms carries a comment that it is a real-time silence test, per Plan 1): `"a /v1 stream silent for 16 s is not cut"` (mock `mock-slow-stream`, first chunk, 16 s pause, remaining chunks and `[DONE]` arrive); `"a non-stream /v1 call that takes 12 s completes"`; `"console-logs/stream stays open with no log traffic for 12 s"`; `"idleTimeout is 255"` (`server.timeout` introspection via a long-lived route test hook).
  - `h2c.test.js` (raw socket, as the old test): `"serves h2c POST requests as HTTP/1.1"` (status line `HTTP/1.1 200`, the body reached the handler intact); `"rejects an h2c body above the cap with 413"` (cap 1 kb); `"a chunked h2c request is served with its body intact"` (**changed from `411`**: the 411 existed because the Node downgrade could not replay chunked framing; Bun parses it, so the intent "no dropped body, normal HTTP/1.1 reply" is asserted instead; note the mapping in the PR). If Bun drops any of the three, add the smallest workaround in `fetch` rather than weakening the test.
  - `disconnect.test.js`: `"request.signal aborts within 1 s when the client disconnects mid-stream"` (route registered through the `routes` hook); `"a /v1 stream abort closes the upstream mock connection"`.
  - `shutdown.test.js`: spawn `bun src/server/index.js` with a temp `DATA_DIR`, send one `/v1/chat/completions` (mock upstream), then `SIGTERM` the child within the usage flush window: `"buffered usage rows are in SQLite after SIGTERM"` and `"process exits 0"` (skip on Windows where signals are not delivered; the case runs on Linux CI).
  - `ca.test.js`: ported cases from `system-ca-trust.test.js`: `"returns the number of system certificates"`, `"throws when the store is empty"`, `"startServer refuses to start when LITEROUTER_SYSTEM_CA=1 and the store is unavailable"`.
- [ ] **Step 2:** Run `cd tests && bun test server/body-limit.test.js server/timeouts.test.js server/h2c.test.js server/disconnect.test.js server/shutdown.test.js server/ca.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement. `maxRequestBodySize: parseBodyLimit(process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE || "128mb")` in `startServer`; `idleTimeout: 255` plus the adapter's per-request `server.timeout(req, 0)` from Task 3; `useSystemCaStore` call at the top of `index.js`'s main-module branch.
- [ ] **Step 4:** Run the same command. Expected: PASS (shutdown skipped on Windows).
- [ ] **Step 5:** Commit: `feat(server): body limit, idle timeouts, h2c, disconnect and shutdown behaviour`.

### Task 8: Port routes, group A (26 files) and the port codemod

Areas: auth 4, locale 1, settings 4, keys 2, combos 2, tags 1, pricing 1, health 1, console-logs 2, proxy-pools 4, provider-nodes 4.

**Files:**
- Create: `scripts/port-next-routes.mjs`, `tests/unit/port-next-routes.test.js`
- Modify: the 26 route files; `tests/unit/auth-status.test.js`, `tests/unit/key-hardening.test.js` (their `vi.mock("next/server" | "next/headers")` become mocks of `@/server/http.js`)
- Test: `tests/server/auth-cookies.test.js`

**Interfaces:**
- `transform(source: string, filePath: string) → string` (pure). CLI: `bun scripts/port-next-routes.mjs [--check] [dirs…]`; `--check` exits 1 while any `next/*` import, `NextResponse`, `.nextUrl`, `export const dynamic|maxDuration|revalidate` remains under the given dirs. **Kept until cutover**: a `main` → `staging` merge brings new `NextResponse` routes, and the merge procedure re-runs it.
- Rules: `import { NextResponse } from "next/server"` → `import { json[, redirect] } from "@/server/http.js"` (only the names used); `NextResponse.json(` → `json(`; `NextResponse.redirect(` → `redirect(`; `new NextResponse(` → `new Response(`; `<id>.nextUrl` and `<id>.nextUrl?.` → `nextUrl(<id>)`; delete `export const dynamic|maxDuration|revalidate = …;`; `import { cookies } from "next/headers"` → `import { cookies } from "@/server/http.js"` and `await cookies()` → `cookies(request)` (reported when no `request` identifier is in scope); idempotent. Output lists every manual follow-up on stderr.

- [ ] **Step 1: Write the failing tests.** `port-next-routes.test.js`: one case per rule, a file with all of them, idempotence, `--check` exit codes. `auth-cookies.test.js` (`startServer`, real `fetch`): `"login sets auth_token with HttpOnly, SameSite=Lax, Path=/, Max-Age=86400"`; `"login over x-forwarded-proto: https adds Secure, and AUTH_COOKIE_SECURE=true adds it without the header"`; `"login without either has no Secure"`; `"logout expires auth_token on Path=/"`; `"auth/status reads the cookie"`; `"locale sets locale with Path=/ and a one-year Max-Age"`; `"login response carries Cache-Control: no-store"`; `"wrong password: 401 with remainingBeforeLock, 6th attempt 429 with Retry-After"`.
- [ ] **Step 2:** Run `cd tests && bun test unit/port-next-routes.test.js server/auth-cookies.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement the codemod. Run `bun scripts/port-next-routes.mjs src/app/api/{auth,locale,settings,keys,combos,tags,pricing,health,console-logs,proxy-pools,provider-nodes}`. Hand-fix what it reports (the four cookie routes; `settings` keeps `bcryptjs` until Task 12).
- [ ] **Step 4:** Run `cd tests && bun test server/auth-cookies.test.js unit/auth-status.test.js unit/key-hardening.test.js unit/login-lockout.test.js unit/compatible-provider-connections.test.js`, then `bun tests/parity/run.mjs --target bun --only api-auth --out tmp-parity` (repeat with each area prefix) and compare. Expected: PASS and no diff outside `known-diffs.json`. A known diff needs a one-line reason and the owner's OK in the PR (expected candidates: `Expires` and attribute casing on `Set-Cookie`, `content-encoding`).
- [ ] **Step 5:** Commit: `refactor(api): port auth, settings, keys, combos, proxy-pools, provider-nodes routes to Web Response`.

### Task 9: Port routes, group B (42 files)

Areas: providers 10, models 7, usage 9, oauth 16.

**Files:** the 42 route files under `src/app/api/{providers,models,usage,oauth}`; tests that mock `next/server` among `tests/unit/{kiro-external-idp,oauth-cursor-auto-import,xiaomi-mimo-oauth-session}.test.js`.

- [ ] **Step 1: Write the pinning test** `tests/server/params-routes.test.js`: `"providers/[id] GET resolves params.id"`, `"oauth/[provider]/[action] resolves both"`, `"usage/[connectionId]/codex-reset-credits resolves connectionId"`, `"oauth/codex/bulk-import is not swallowed by [provider]/[action]"` (static beats param), `"percent-encoded id is decoded"`. These already pass on the unported tree (the adapter does the work); they exist to keep passing through the port.
- [ ] **Step 2:** Run `bun scripts/port-next-routes.mjs src/app/api/{providers,models,usage,oauth}`; hand-fix `oauth/[provider]/[action]` (two params), `models/*` (`nextUrl` in `models/route.js`), and every `{ params }` consumer (they keep `await params`, since the adapter passes a Promise). Then `bun scripts/port-next-routes.mjs --check src/app/api/{providers,models,usage,oauth}`. Expected: exit 0.
- [ ] **Step 3:** Run `cd tests && bun test unit/kiro-external-idp.test.js unit/oauth-cursor-auto-import.test.js unit/xiaomi-mimo-oauth-session.test.js unit/provider-validate-ssrf.test.js server/params-routes.test.js` and the parity fixtures for these areas. Expected: PASS, no unexplained diff.
- [ ] **Step 4:** Commit: `refactor(api): port providers, models, usage, oauth routes to Web Response`.

### Task 10: Port routes, group C (28 files): `/v1`, `/v1beta`, pxpipe, headroom

Areas: v1 12, v1beta 2, pxpipe 8, headroom 6. These carry the streaming and proxying paths.

**Files:** the 28 route files; `src/server/guard.js` untouched.

- [ ] **Step 1: Write the failing tests** `tests/server/v1-routes.test.js`: `"/v1/chat/completions, /v1/v1/chat/completions and /api/v1/chat/completions all reach the same handler"`; `"/codex/responses and /responses reach api/v1/responses"`; `"/v1/models/:kind and /v1/models/a/b/c (catch-all) resolve"` (`params.model` is `["a","b","c"]`); `"/v1beta/models/gemini:generateContent resolves the catch-all as one segment"`; `"headroom/proxy/[...path] forwards the rest of the path"` (mock upstream); `"headroom and pxpipe localhost-only routes are 403 for a proxied request"`.
- [ ] **Step 2:** Run it before porting. Expected: FAIL where the route module still needs `next/*` features.
- [ ] **Step 3:** Run `bun scripts/port-next-routes.mjs src/app/api/{v1,v1beta,pxpipe,headroom}`; hand-fix `headroom/proxy` (`new NextResponse` ×2 and `rewriteDashboardHtml`) and `v1/models*` (`nextUrl`).
- [ ] **Step 4:** Run `bun scripts/port-next-routes.mjs --check src` (exit 0: nothing under `src/app/api` or `src/server` mentions `next/`), the new test, `cd tests && bun test unit/default-executor-stream-options.test.js unit/executor-abort-and-discard.test.js` and the **whole** parity run with `compare.mjs`. Expected: all green; the `v1-*` SSE fixtures show identical frames and identical upstream request bodies and headers.
- [ ] **Step 5:** Commit: `refactor(api): port v1, v1beta, pxpipe, headroom routes to Web Response`.

### Task 11: DB driver trimmed to `bun:sqlite`; export/import and backup fixtures

**Files:**
- Modify: `src/lib/db/driver.js`; keep `src/lib/db/adapters/bunSqliteAdapter.js` as the only adapter
- Delete: `src/lib/db/adapters/{betterSqliteAdapter,nodeSqliteAdapter,sqljsAdapter}.js`
- Modify: `package.json` (remove `better-sqlite3`, `sql.js`, the `comment_better_sqlite3` key), `next.config.mjs` `serverExternalPackages`
- Modify tests that import the deleted adapters: `tests/unit/{db-driver-chain,db-null-byte-params,db-reliability-t8,key-access-migration,api-key-cache-access}.test.js`
- Create: `tests/unit/db-bun-pragmas.test.js`, `tests/unit/db-export-import-compat.test.js`, `tests/unit/db-backup-lite.test.js`, `tests/fixtures/db/{main-export.json,main-written.sqlite,legacy-main.seed.json}`, `tests/fixtures/db/README.md`

**Interfaces:**
- `driver.js`: `getAdapter()` / `getAdapterSync()` unchanged; `initAdapter` calls `createBunSqliteAdapter(DATA_FILE)` directly, wraps with `withNullByteSafeParams`, and throws `"LiteRouter requires the Bun runtime (bun:sqlite)"` when `process.versions.bun` is missing. The adapter keeps `PRAGMA_SQL`.
- The fixtures are produced **once** from `main`'s code under the production Node image (Node ≥ 22.5, `node:sqlite`), the only place Node is used; `README.md` records the commands, the commit sha and Node version. `main-export.json` is `exportDb()` of a seeded DB (settings, 2 connections, node, proxy pool, 2 keys incl. restricted access, combo, alias, custom model, pricing); `main-written.sqlite` is the DB file that seeded run left behind.

- [ ] **Step 1: Write the failing tests.**
  - `db-bun-pragmas.test.js`: `"opens in WAL with the documented pragmas"` reads back `journal_mode` = `wal`, `synchronous` = 1, `temp_store` = 2, `cache_size` = -16000, `wal_autocheckpoint` = 1000, `foreign_keys` = 1, `busy_timeout` = 5000; `"user_version/_meta schema version equals SCHEMA_VERSION"`; `"a second open of the same file in the same process reuses one connection"`.
  - `db-export-import-compat.test.js`: `"main's export imports and re-exports identically"` (`importDb(main-export.json)` then `exportDb()` deep-equals the fixture); `"export from the new build equals main's export for the same seed"` (seed through `legacy-main.seed.json`, compare to `main-export.json` after sorting keys; this is the "new export imports into main" direction, since the payload is byte-identical); `"a DB file written by main opens unchanged"` (copy `main-written.sqlite` to a temp `DATA_DIR`, open, no migration runs, `exportDb()` equals `main-export.json`); `"a DB file written by the new build passes integrity_check and keeps WAL"`.
  - `db-backup-lite.test.js`: `"backupDbLite copies every table except requestDetails"`; `"the backup opens with bun:sqlite and row counts match"`; `"table names that need quoting survive the CREATE TABLE rewrite"` (use the real `buildCreateTableSql` output for every table in `TABLES`).
- [ ] **Step 2:** Run `cd tests && bun test unit/db-bun-pragmas.test.js unit/db-export-import-compat.test.js unit/db-backup-lite.test.js`. Expected: FAIL (fixtures and trimmed driver missing).
- [ ] **Step 3:** Generate the fixtures from a `main` worktree under Node, commit them, trim `driver.js`, delete the three adapters, update `package.json`, `next.config.mjs` and the five tests (each keeps its count; assertions that compared drivers assert `bun:sqlite` and the null-byte wrapper).
- [ ] **Step 4:** Manual rollback gate, recorded in the PR (Plan 5 repeats it on prod data): copy a DB written by the Bun build into a Node-image run of `main` and confirm `/api/health` and `exportDb()` work. Then run `cd tests && bun test unit/db-*.test.js unit/key-access-migration.test.js unit/api-key-cache-access.test.js` and `rg "sql\.js|better-sqlite3|node:sqlite" src open-sse -g '!*.md'`. Expected: PASS; the grep finds nothing.
- [ ] **Step 5:** Commit: `refactor(db): bun:sqlite only; export/import and backup compat fixtures`.

### Task 12: Bun-native dependency swaps

**Files:**
- Create: `src/lib/auth/password.js`, `open-sse/utils/uuidv5.js`, `src/shared/utils/openBrowser.js`
- Modify: `src/app/api/auth/login/route.js`, `src/app/api/settings/route.js`, `src/lib/auth/dashboardSession.js`; the 15 files importing `uuid` (`rg "from \"uuid\"" src open-sse`); `src/lib/oauth/services/{oauth,xai}.js`; `tests/unit/kimi-responses-transport.test.js` (its `vi.mock("uuid")`)
- Modify: `package.json` (remove `bcryptjs`, `uuid`, `open`), `tests/package.json` (`bcryptjs` as a **devDependency**, only for the reverse-compat test)
- Test: `tests/unit/password-bcrypt-compat.test.js`, `tests/unit/uuidv5.test.js`, `tests/unit/open-browser.test.js`, `tests/unit/machine-id-bun.test.js`

**Interfaces:**
- `password.js`: `hashPassword(plain: string) → Promise<string>` (`Bun.password.hash` bcrypt cost 10 on the **first 72 bytes** of the UTF-8 password, so a rollback to bcryptjs can still verify it); `verifyPassword(plain: string, hash: string) → Promise<boolean>` (`Bun.password.verify`; on `false` and a password over 72 bytes retry with the first 72 bytes; a throw, an empty or non-string input → `false`).
- `uuidv5(name: string, namespace: string = UUID_NS_DNS) → string` and `UUID_NS_DNS`, SHA-1 per RFC 4122, for `open-sse/utils/cursorChecksum.js`. `uuidv4()` call sites become `crypto.randomUUID()`.
- `openBrowser(url: string, { spawn = Bun.spawn, platform = process.platform } = {}) → Promise<void>`: win32 `rundll32 url.dll,FileProtocolHandler <url>`, darwin `open <url>`, else `xdg-open <url>`; rejects non-`http(s)` URLs; a failed launch rejects like `open` did (call sites at `oauth.js:139` and `xai.js:201` already sit inside a try).
- `node-machine-id` **stays** as a runtime dependency: it is pure JS (registry/`ioreg`/`/etc/machine-id`), runs under Bun, and `open-sse/shared/machineId.js` feeds an upstream-visible identity that must not change; the CLI also depends on it. The `x-9r-cli-token` value is `sha256(raw + "9r-cli-auth" + cliSecret)[0:16]` from persisted files and is unaffected.

- [ ] **Step 1: Write the failing tests.**
  - `password-bcrypt-compat.test.js`, with **literal hashes written by bcryptjs 3.0.3**: `"verifies a $2b$ hash"`, `"verifies a $2a$ hash"`, `"verifies a unicode password"`, `"verifies an 80-byte password hashed by bcryptjs"` (the 72-byte retry), `"verifies a password that splits a multi-byte character at byte 72"`, `"rejects a wrong password and an empty password"`, `"returns false (not throws) for a non-hash string"`; plus `"hashes made by hashPassword verify under bcryptjs.compareSync"` (short and 80-byte) and `"hashPassword emits $2b$10$"`. Also `"the parity seed hash (password parity-pass) verifies"`.
  - `uuidv5.test.js`: `"matches uuid@13 v5 for the DNS namespace"` against literals captured from the `uuid` package in this step for `"www.example.com"`, `""` and a multi-byte string; `"cursorChecksum session id is unchanged"` (the existing function's output for a fixed token equals the literal captured from the old code).
  - `open-browser.test.js`: argv per platform (injected `spawn`), `"rejects javascript: and file: URLs"`, `"propagates a spawn failure"`.
  - `machine-id-bun.test.js`: `"machineIdSync works under Bun and is stable"` (non-empty, two calls equal); `"getConsistentMachineId('9r-cli-auth') from seeded machine-id and cli-secret files equals the sha256 formula"` using a literal computed by the old code; `"open-sse/shared/machineId derives from machineIdSync"`.
- [ ] **Step 2:** Run `cd tests && bun test unit/password-bcrypt-compat.test.js unit/uuidv5.test.js unit/open-browser.test.js unit/machine-id-bun.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement the three modules; switch the call sites; remove the three dependencies; `bun install`.
- [ ] **Step 4:** Manual gate recorded in the PR: on the dev box run `node -e "console.log(require('node-machine-id').machineIdSync())"` and `bun -e "console.log(require('node-machine-id').machineIdSync())"`; the values must match. Then run the four new test files, `cd tests && bun test unit/login-lockout.test.js unit/xai-oauth-service.test.js unit/kimi-responses-transport.test.js unit/cursor-*.test.js`, and `rg "from \"(uuid|bcryptjs|open)\"" src open-sse`. Expected: PASS; the grep finds nothing.
- [ ] **Step 5:** Commit: `refactor: bun-native password, uuid and browser launcher; keep node-machine-id`.

### Task 13: Per-executor Bun smoke tests against the mock upstream

**Files:**
- Create: `tests/server/executors-smoke.test.js`, `tests/server/helpers/executor-cases.js`, `tests/parity/fixtures/tls/{cert.pem,key.pem}`
- Modify (only if the spike shows a Bun gap): `open-sse/executors/cursor.js`, `open-sse/utils/zstdCompat.js`

**Interfaces:**
- `executor-cases.js` exports `cases: Array<{ provider, wire: "openai-sse"|"openai-json"|"anthropic"|"eventstream"|"ndjson"|"h2-proto"|"web-sse", credentials, body, mock: (mockUpstream) => void, decode?: (Response) => Promise<string>, expectText: string }>`. One case per key of the `factories` map in `open-sse/executors/index.js` (28) plus `default` (any OpenAI-compatible provider). Each case points the executor at the mock by overriding the instance's `buildUrl` (and the base URL field when the executor has one), calls `executor.execute({ model, body, stream, credentials, signal, log })`, and asserts status 200, the path and auth header shape the mock saw, and `expectText` in the decoded stream.
- Binary cases decode with the code path production uses: **kiro** EventStream frames through the kiro response translator, **commandcode** NDJSON through its transform, **cursor** over `node:http2` (mock = `http2.createSecureServer` with the fixture TLS pair; the test sets `NODE_TLS_REJECT_UNAUTHORIZED=0` for its duration, or, if Bun's client ignores it, `CursorExecutor` gets an `http2ConnectOptions` field passed to `http2.connect`), **zstd** (`grok-web` and `default`: the mock returns `content-encoding: zstd` made with `Bun.zstdCompressSync`).

- [ ] **Step 1: Write the failing tests.** `"case table covers every executor factory key plus default"` (parses `factories` keys from `open-sse/executors/index.js`); one `test.each` row per case, named `"<provider> executor round-trips against the mock upstream"`; `"cursor over node:http2 streams a protobuf response"`; `"kiro EventStream decodes to text"`; `"commandcode NDJSON decodes to text"`; `"ACCEPT_ENCODING advertises zstd exactly when the runtime can decode it"`; `"zstd, br and gzip bodies from the mock decode through proxyAwareFetch"`; `"executor aborts promptly on signal"` for `default` and `cursor`.
- [ ] **Step 2:** Run `cd tests && bun test server/executors-smoke.test.js`. Expected: FAIL (cases missing).
- [ ] **Step 3:** Generate the TLS pair once: `openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 36500 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`. Write the cases. Where an executor fails on Bun, fix it with the Bun-native equivalent (for the cursor h2 path, the minimal change that keeps the duplex semantics) and say so in the PR; a gap with no fix is logged under "Open risks" in this plan and the case is marked `test.failing` with the issue link, never skipped silently.
- [ ] **Step 4:** Run the file. Expected: PASS, 29 case rows plus the extras. Run the whole suite and `verify-no-regression.mjs` / `verify-test-counts.mjs` on the junit output.
- [ ] **Step 5:** Commit: `test(executors): Bun smoke test for every executor against the mock upstream`.

### Task 14: Delete Next's server pieces; scripts, docs, CI

**Files:**
- Delete: `custom-server.js`, `src/proxy.js`, `src/instrumentation.js`, `tests/unit/custom-server-peer-headers.test.js`, `tests/unit/custom-server-h2c.test.js` (replaced in Tasks 5 and 7)
- Modify: `next.config.mjs`, `package.json`, `CLAUDE.md`, `.github/workflows/test.yml`, `CHANGELOG.md`, `.env.example` (drop nothing; confirm `TRUST_LOOPBACK_AS_LOCAL`, `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` comments still true)
- Modify: `tests/unit/standalone-assets.test.js` only if it referenced `custom-server.js`

- [ ] **Step 1:** In `next.config.mjs` remove `rewrites()`, `experimental.proxyClientMaxBodySize` (and the const), `serverExternalPackages`, and the `/instrumentation` and `/middleware` keys in `outputFileTracingExcludes`. Keep the rest: it is only the build config for the pages Plan 3 ports.
- [ ] **Step 2:** In `package.json`: `"dev": "bun --hot src/server/index.js"`, `"start": "bun src/server/index.js"`; delete `dev:bun`, `start:bun`, `dev:webpack`; keep `build`/`build:bun` (Next pages only) and make `predev`, `prebuild`, `postbuild*` run `bun`. Remove no other dependency.
- [ ] **Step 3: Write the failing guard tests** `tests/server/no-next-server.test.js`: `"no src/server or src/app/api file imports next/*"`; `"custom-server.js, src/proxy.js, src/instrumentation.js do not exist"`; `"no source reads NINEROUTER_PEER_TOKEN or trusts x-9r-real-ip"` (grep over `src` and `open-sse` for the three header names, allowing only the strip list in `index.js`); `"next.config.mjs has no rewrites"`. Write it, run it (FAIL, files still exist), then delete the files and do Steps 1–2 and run it again (PASS).
- [ ] **Step 4:** Update `CLAUDE.md`: Commands (`PORT=20128 bun --hot src/server/index.js` for dev, `bun src/server/index.js` for prod; **delete the paragraph about `next dev` treating every request as remote**, and say `bun --hot` sees real peer IPs, that `/` → `/dashboard`, and the localhost-only routes work in dev), Architecture (request flow now `Bun.serve` routes → `src/server/guard.js` → `adapter.js` → `src/sse/handlers/chat.js`; the `custom-server.js` convention becomes the IP/trust paragraph pointing at `src/server/trust.js`), Persistence (`bun:sqlite` only; remove the adapter chain text), Tests (`tests/parity`, `tests/server`). Add a `CHANGELOG.md` "Unreleased" entry.
- [ ] **Step 5:** In `test.yml`, after the existing steps add `bun tests/parity/run.mjs --target bun --out parity-actual` and `bun tests/parity/compare.mjs tests/parity/expected parity-actual`; keep `bun run build:bun`. Run the whole suite: `cd tests && bun run test:junit`, then `bun __baseline__/verify-no-regression.mjs ../test-results.xml` and `bun __baseline__/verify-test-counts.mjs ../test-results.xml`. Expected: green.
- [ ] **Step 6:** Final checks, all expected to print nothing or exit 0: `bun scripts/port-next-routes.mjs --check src`, `bun scripts/gen-route-table.mjs --check`, `rg "from ['\"]next/(server|headers)" src`, `rg "custom-server|NINEROUTER_PEER_TOKEN" src open-sse scripts package.json`, `rg "sql\.js|better-sqlite3|bcryptjs|from ['\"](uuid|open)['\"]" src open-sse package.json`.
- [ ] **Step 7:** Commit: `chore: remove Next's server pieces; Bun scripts, docs and parity CI step`.

---

## What remains of Next after this plan

`next`, `@next/third-parties`, `@next/swc-linux-x64-musl`, `eslint-config-next` in `package.json`; a trimmed `next.config.mjs`; `src/app/**/page.js`, the two layouts, `globals.css` and the `next/*` imports in the dashboard components (`DashboardOverview`, `TokenSaverClient`, `RuntimeI18nProvider`, `Header`, `DashboardLayout`, `Sidebar`, `UsageStats`) — all Plan 3 — and `build:bun` plus `scripts/copy-standalone-assets.mjs` — Plan 4. `src/app/api/**` stays where it is: the route table imports those files, and Plan 4 decides their final location when `src/app` is deleted. The Dockerfile, `cli/` and `package-lock.json` still describe the Next standalone build and are rebuilt in Plan 4.

## Done when

- `bun src/server/index.js` serves every `/v1`, `/v1beta`, `/codex`, `/responses` and `/api` route, the SPA placeholder after the guard, `public/` files and the manifest; `bun tests/parity/run.mjs --target bun` + `compare.mjs` against the recorded Next outputs reports no diff outside `known-diffs.json`.
- The route-table drift test and `gen-route-table.mjs --check` pass; `port-next-routes.mjs --check src` passes.
- The trust, h2c, body-limit, timeout (16 s silence), disconnect and SIGTERM tests pass; no source reads `x-9r-real-ip` or `NINEROUTER_PEER_TOKEN`.
- `bun:sqlite` is the only driver; export/import and DB-file fixtures from `main` pass in both directions; the rollback gate is recorded.
- `bcryptjs`, `uuid`, `open`, `sql.js`, `better-sqlite3` and `undici` are gone from `package.json`; the bcrypt compat tests pass with real bcryptjs hashes.
- All 29 executor smoke cases pass on Bun; `verify-no-regression.mjs` and `verify-test-counts.mjs` are green.

## Open risks (resolve in the task named, or hand to Plan 5)

- **Compression:** Next gzips `/api` JSON by default; `Bun.serve` does not. Production sits behind Cloudflare, which compresses at the edge, so the parity diff (`content-encoding`) is expected to be a known diff. Task 8 asks the owner to confirm.
- **`x-forwarded-for` now stripped only after the context is built**, as before; confirm request-detail rows still hold no raw XFF (Task 5 test).
- **Cursor `node:http2`** may not honour Bun's TLS env or duplex semantics (Task 13 spike).
- **Bun cookie serialisation** (`Expires`, casing, `delete` defaults) differs from Next (Task 8).
- **System CA store** on Bun depends on what Plan 1 Task 8 found; the fail-closed rule must survive (Task 7).
