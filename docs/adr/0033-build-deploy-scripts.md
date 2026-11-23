# ADR-0033: Build output, deployment and scripts

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

LiteRouter ships as a Next.js standalone build used by Docker, the CLI launcher and Netlify relay deployments, and is built on one OS and run on another. Several decisions in `next.config.mjs`, the startup path, and the deploy tests exist because a naive default broke a real release or deployment. They concern bundling, runtime-only environment, startup ordering and deploy safety.

## Decisions

### D1. The `open` package must stay external in the bundle (superseded)

Status: superseded. The `open` dependency and its `serverExternalPackages` entry in `next.config.mjs` were removed with Next's server; `src/shared/utils/openBrowser.js` now opens the browser with no package. The original decision and its reason are kept below as history.

`open` derives its directory from `import.meta.url`, and webpack replaces that with the absolute path of the build machine as a string literal. A release built on macOS then ships `file:///Users/.../open/index.js`, which `fileURLToPath` rejects on Windows with ERR_INVALID_FILE_URL_PATH ("File URL path must be absolute", no drive letter). The throw happens at module scope and kills every importer, including xAI/Grok token refresh (`refreshXaiToken` imports the OAuth service that imports `open`), so no Grok refresh could reach auth.x.ai on Windows. Keeping it in `serverExternalPackages` preserved the real `import.meta.url` at runtime, and a regression test guarded it. Replacing the package with `openBrowser.js` removes the failure class: there is no `import.meta.url` build-path literal left to throw, and `tests/unit/open-package-external.test.js` now asserts that no server source imports `open`, that it is not in `package.json`, and that the launcher is built on `Bun.spawn`.

**Where:** `src/shared/utils/openBrowser.js`; `tests/unit/open-package-external.test.js` (the `open` package and `serverExternalPackages` in `next.config.mjs` are gone)

### D2. Tracing root differs for CLI bundling and Docker

CLI bundling (`NEXT_TRACING_ROOT_MODE=workspace`) needs the workspace root so tracing includes hoisted `node_modules` (a slim build of about 50 MB). Docker and the default use `projectRoot` so `server.js` lands at `/app/server.js` rather than nested. The request body limit is raised (default 128mb, `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE`, now enforced as `maxRequestBodySize` by `Bun.serve` through `src/server/bodyLimit.js` rather than Next's `proxyClientMaxBodySize`) because LLM clients send long context or base64 image payloads to `/v1` (#1529, #1572).

**Where:** `next.config.mjs`: `tracingRoot`; `src/server/bodyLimit.js`: `parseBodyLimit`

### D3. Startup work is server-only, deferred and bootstrapped from the server boot

API-only servers never render `app/layout.js`, so background bootstrap (token refresh and similar) starts from `runBootOnce` in `src/server/boot.js`, which replaced Next's `instrumentation.js`; `bootstrap.js` guards itself with `global.__appBootstrapped`. Heavy startup work (DB cleanup, OAuth pings) is deferred so the first HTTP request (login to dashboard) is not starved. Server-only imports in the boot steps let `capabilities.js` read the synced catalog without pulling `node:fs` into the browser bundle. The scheduler stays absent unless an account opted in, and its provider graph loads on demand.

**Where:** `src/server/boot.js`: `runBootOnce`; `src/shared/services/initializeApp.js`; `src/app/api/settings/route.js`

### D4. Runtime values and server-side files must not be baked in at build

`TZ` is a runtime environment variable, so the dashboard layout never bakes the build machine's zone into the page. The console-log page is forced dynamic so the standalone build includes its server-side JS file. The standalone asset copy script used to place a sanitizing wrapper (`custom-server.js`) beside `server.js`, because without it the standalone build served requests unsanitized. That part is superseded: Next's server is no longer the entry point, `custom-server.js` is deleted, and request sanitizing now lives in `src/server/index.js` and `src/server/trust.js` (ADR 0001), which run for every request in the one Bun server. `scripts/copy-standalone-assets.mjs` still copies static assets and the generated server tree, copies no wrapper, and `tests/unit/standalone-assets.test.js` asserts that.

**Where:** `src/web/App.jsx`; `src/web/pages/dashboard/console-log/page.js`; `scripts/copy-standalone-assets.mjs`; `src/server/index.js`; `src/server/trust.js`; `tests/unit/standalone-assets.test.js`

### D5. Deploy must block on health and never remove the old tag before verifying

`docker compose up -d` returns while the healthcheck is still `starting`, which let a successful deploy exit before the prune step, so the deploy blocks on health. Removing the old image tag before the new one is verified would leave a failed deploy with nothing to roll back to. The Netlify relay bundle must use `exports.handler` and return a string body: live-verified failures were `export default` (Runtime.UserCodeSyntaxError, 502) and a stream object as the body (cannot-unmarshal-object-into-Go-struct, 502).

**Where:** `tests/unit/deploy-script.test.js`; `tests/unit/netlify-relay.test.js`

### D6. Benchmark mock upstream replies inline at zero delay

A `setTimeout(0)` is quantised to about 15 ms on Windows, which would hide gateway overhead, so a delay of 0 replies inline.

**Where:** `scripts/bench/mock-upstream.mjs`

## Consequences

- Bundling `open` broke every Windows run of a cross-built release, starting with Grok token refresh (history; the package is gone).
- A wrong tracing root yields a nested `server.js` in Docker or missing hoisted modules in the CLI bundle.
- Deploy scripts that do not wait for health, or prune before verifying, lose rollback ability.
- Baking TZ or omitting server files from the standalone build gives wrong times or missing handlers in production.
- Running the standalone `server.js` directly skips the Bun server's request sanitizing; the supported entry is `bun src/server/index.js`.
