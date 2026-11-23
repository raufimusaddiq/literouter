# Bun Rewrite — Plan 4: Packaging, CLI and CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Bun server as a `dist/app` bundle (for the CLI) and as `bun build --compile` musl executables (for Docker, amd64 and arm64, image ≤ 150 MB). Rename the CLI to `literouter` (Bun-only). Move CI and the staging image to Bun. Finally remove Next.js, `better-sqlite3`, `sql.js`, `package-lock.json` and every `node` invocation from the repo.

**Architecture:** One `Bun.build` config (`scripts/build.mjs`) produces the bundle; with `compile: { target, assets: ["public"] }` the same config produces the executables, so `public/` and the SPA are embedded and resolved relative to `import.meta.dir`. The Docker image is `alpine` plus that executable. The CLI launches `dist/app/index.js` with the user's Bun. CI gains an image job (size gate, amd64 + arm64 smoke) and a `staging` workflow that pushes to a separate GHCR repository, so a staging tag can never pass the production deploy script.

**Tech Stack:** Bun 1.4.4 (`Bun.build` with `bun-plugin-tailwind`, `compile`, `Bun.spawn`, `bun:test`), Alpine 3.22, `oven/bun:1.4.4-alpine`, Docker buildx, GitHub Actions, ESLint 9 flat config.

**Spec:** `docs/superpowers/specs/2026-11-22-bun-rewrite-design.md` (§2.5, §2.8, §6.6, §6.7, §6.8, §9.2, §9.5, §9.7, §9.8). Names follow `docs/superpowers/plans/2026-11-22-bun-rewrite-00-index.md` (Build section). Plans 1–3 are merged: tests run on `bun test`, `src/server/index.js` (`startServer`) serves everything, the SPA is bundled from `src/web/`, Next is not imported at runtime.

## Reconciliation (2026-11-23): overrides the task text below

The index contract (`2026-11-22-bun-rewrite-00-index.md`) wins over this plan where they differ.

- **No HTML imports.** Plan 3 found that an imported `HTMLBundle` is opaque, so the boot data can't be injected after the guard. The SPA is built by Plan 3's `buildWeb()` and read from disk, or from the embedded files.
- **Task 4 `buildApp`:**
  1. Run `buildWeb({ production: true, outdir: <outdir>/web })` first.
  2. `Bun.build` only `src/server/index.js`. With no HTML entry, the `server.js`/HTML collision is gone; keep `index.js` anyway.
  3. Copy `public/` to `<outdir>/public`.
- **`compileApp`:** embed both `public/` and `web/`, so that `PUBLIC_DIR` and `SPA_DIR` from `src/server/paths.js` resolve under `import.meta.dir`. Probe how `compile.assets` maps directory paths, and assert it with a test.
  - The `"served 200 on a deep route"` check must go through `serveSpa` with `__LR_BOOT__` present, not through an HTML import.
- **Task 1:** `src/server/paths.js` already exists from Plans 2 and 3, holding `PUBLIC_DIR`, `SPA_DIR` and the `LITEROUTER_*` overrides. **Extend it** with `isBundled`, `assertBundleCwd` and the bundled branches; don't create it.
  - Re-check whether the cwd dependence still exists once there's no HTML import. Keep the clear-failure guard only if it does.
- **Task 3 (`ca.js`):** replace the mechanism that Plan 2's `useSystemCaStore()` uses, and keep the name. The new signature, `(tlsApi = tls, fetchHost = globalThis)`, stays call-compatible.
- **Task 13:** add the new image jobs to the required checks on `staging`. **The owner applies that branch-protection change; prepare it, but don't apply it yourself.**
- **ESLint migration already landed.** The ESLint migration off `eslint-config-next` landed in Plan 3 Task 6 (`eslint-config-next` needs the `next` package to load); Plan 4 verifies it rather than redoing it.
  - `.next/**` and `next-env.d.ts` stay in the eslint ignores until Plan 4 removes `.next` everywhere.
  - `eslint-plugin-jsx-a11y` and `eslint-plugin-import` are kept by the new flat config; don't describe them as dropped.
- **Plan 3 handoffs for the bundled/compiled server.**
  - `spaBuild.js` statically imports `src/web/build.js`, whose `import("bun-plugin-tailwind")` a server `Bun.build` will trace. Load `build.js` lazily or mark the plugin external.
  - Bundled and compiled runs must count as production so they never reach `devBuild`/`fs.watch`. Today only `NODE_ENV=production` does that.
  - `buildApp` must clean `<outdir>/web` before `buildWeb`, which doesn't empty its outdir.
  - Probe `stat` and `realpath` on `/$bunfs` roots, which `static.js` containment relies on.

## Global Constraints

- Bun is pinned to **1.4.4** in `package.json` `engines.bun`, `cli/package.json` `engines.bun`, every workflow (`bun-version: 1.4.4`) and the Docker build image `oven/bun:1.4.4-alpine`. A test asserts they agree (Task 1).
- Compile targets are exactly `bun-linux-x64-musl` and `bun-linux-arm64-musl`. Docker image ≤ **150 MB uncompressed per arch**; target ~120 MB. Measured: compiled hello-world exe 98–103 MB, the whole engine adds ~1 MB, an Alpine runtime with `libstdc++ libgcc ca-certificates su-exec` and the exe measured **105.6 MB**.
- No `node`, `npm`, `npx`, `setup-node` or `node --test` anywhere in CI, the Docker build, the runtime, the CLI or `scripts/`. Gate (`NODE_GATE`, used verbatim by Task 14's test and CI): `rg -n "(^|[ \"'(=])(node|npm|npx)([ \"')]|\.exe|$)" .github scripts Dockerfile cli -g '!cli/test/**' -g '!*.md'` prints nothing. (`node:fs`, `node-machine-id`, `process.versions.node` and `NODE_ENV` do not match.)
- Unchanged names: `~/.9router`, `DATA_DIR`, every `NINEROUTER_*` env var, `x-9r-*` headers, cookie names, port 20128, the `PORT`/`HOSTNAME`/`DATA_DIR` env contract, `/app/data` and `/app/data-home`, `NODE_ENV=production`, `TZ`.
- **No test is deleted or weakened.** Tests of removed mechanisms (standalone tracing, `next.config.mjs`, custom-server) are replaced by tests of the same user-visible behaviour with at least the same case count. `tests/__baseline__/test-counts.json` is updated in the same PR (old key removed, new key added), and the PR description lists `old → new`.
- Production must never be deployable from `staging`: staging images go to `ghcr.io/<repo>-staging` with tags `staging-<sha>`; `scripts/deploy.sh` accepts only `ghcr.io/raufimusaddiq/literouter-production:production-<40 hex>`.
- Publishing to npm and `npm deprecate 9router` are outward actions. **Nothing in this plan runs them.** Task 15 prepares them; **Plan 5 (cutover) owns executing them, only after the owner says go.**
- Conventional Commits; every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work lands on `staging` through PRs (rig auto-merge flow). Delegated or subagent work runs on **Sonnet 5.5** (`model: "sonnet"`).

## Review Focus

1. **`dist/app` resolves its assets relative to the process cwd.** Probed: a non-compiled bundle's HTML manifest and file imports are cwd-relative, so `bun /abs/dist/app/index.js` from another directory dies with `Bundled file ... not found`. The launcher and `start` must run with cwd = `dist/app`, and a direct run from elsewhere must fail with a clear message. Pinned by Task 4 (`bundle-cwd` test) and Task 10.
2. **A compiled executable spawned through `process.execPath` re-runs the server, not Bun.** Devin's MCP command, the pxpipe install and the compose healthcheck all spawn `process.execPath`. Without `BUN_BE_BUN=1` they start a second server or hang. Pinned by Task 2.
3. **Outbound TLS silently falling back to Bun's bundled roots.** Probed: Bun's `fetch` ignores `tls.setDefaultCACertificates`, and `tls: { ca: [] }` means "use defaults". An empty OS store must refuse to start, and a non-empty store must be applied to every `fetch`. Pinned by Task 3.
4. **Old Node launcher respawning its server.** The pidfile records the server pid, not the launcher's. Killing only the server lets the old launcher restart it on the same port and win the race. The takeover must stop the launcher first, and must not touch a foreign or stale process. Pinned by Task 11.
5. **Existing production volume ownership and the staging/production boundary.** Files in `/app/data` are owned by uid 1000 (`node` in the old image). The new user must be uid/gid 1000, and a `staging-<sha>` image must be refused by the deploy scripts. Pinned by Task 7 and Task 13.

---

## Probe findings this plan is built on (2026-11-23, Bun 1.4.4, Windows, Docker 27.5 engine)

Raw probes: `C:\Users\KOMPUTER\AppData\Local\Temp\claude\680b3c0368b65e0c\3e4ce144-be4b-4e34-ac1d-24ec5555884a\scratchpad\p4-probe` (may be gone; rerun if needed).

- **Embedding works.** `compile` embeds `with { type: "file" }` imports, HTML imports (the SPA, with `bun-plugin-tailwind` CSS, served 200 on a deep route `/dashboard/providers/abc`), JSON imports and `bun:sqlite`. `import.meta.dir` is `/$bunfs/root`; `fs.readFileSync(path.join(import.meta.dir, "../x"))` and `process.cwd()/package.json` reads fail with `ENOENT`.
- **`compile.assets: ["public"]`** (CLI `--asset=public`) embeds a directory at `public/...`, readable with `Bun.file(path.join(import.meta.dir, "public", rel))` in the exe. The same expression works in the non-compiled bundle if `public/` is copied next to it. Extra `.png` entrypoints are **not** raw in a non-compiled build (they become JS modules), so use `assets`.
- **Bundle config that works in both modes:** `target: "bun"`, `publicPath: "/"`, `naming: { entry: "[name].[ext]", chunk: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" }`, `plugins: [bun-plugin-tailwind]`. A literal `entry: "server.js"` fails (`Multiple files share the same output path`, collides with the HTML entry), so the server entry is `dist/app/index.js`. A `chunks/` subdirectory in `naming.chunk` makes the SPA chunk 404 in the non-compiled bundle. `publicPath: "/"` turns `with {type:"file"}` paths absolute, so server code must not use file imports (it uses `import.meta.dir`).
- **`import.meta.main`** is true only for the entry module in the bundle and in the exe.
- **`BUN_BE_BUN=1`** makes the exe behave as the `bun` CLI: `--version` prints 1.4.4 and `-e "..."` runs. Bun accepts `--dns-result-order=ipv4first` (works) and `--max-old-space-size` (accepted, ignored).
- **Compile cross-target:** both musl targets compile from Windows in about 12 s (x64 103.9 MB, arm64 102.8 MB incl. a trivial app). The arm64 exe could not be run locally (no QEMU binfmt on this Docker); CI uses `setup-qemu-action`.
- **Real code bundles.** `Bun.build` over `src/sse/handlers/chat.js`, `open-sse/handlers/chatCore.js`, `src/lib/db/index.js`, `devin-cli.js`, `pxpipe/loader.js`, `machineId.js`, `modelCatalog/sync.js` produced 1.17 MB, 0 warnings, ran, and compiled to a 103.9 MB musl exe that ran in Alpine. It also exposed one bug: `getAppVersion()` returned `0.0.0` (it reads `process.cwd()/package.json`), and `appConstants.js` `createRequire(import.meta.url)("../../package.json")` would too.
- **System CA:** `tls.getCACertificates("system")` works (118 certs in Alpine). `NODE_USE_SYSTEM_CA=1` or `--use-system-ca` only **adds** the system roots to Bun's 118 bundled ones (default 236) and cannot remove a root. `tls.setDefaultCACertificates` exists and changes `tls.getCACertificates("default")`, but native `fetch` ignores it (a fetch with the list set to `[]` still returned 200). Per-request `fetch(url, { tls: { ca: [one cert] } })` replaces trust (a wrong cert fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`); `ca: []` is treated as unset. Without `/etc/ssl/certs` the system list is empty.
- **TZ** works without `tzdata` (`TZ=Asia/Jakarta` gives GMT+0700 in a bare Alpine).
- **Windows `EBUSY`:** with `BUN_INSTALL` pointed at a scratch dir, `bun add -g ./pkg-1.0.1.tgz` while the global launcher `.exe` and a detached server child (its **cwd inside the install dir**) were running exited 0, replaced the files in place, and printed no `EBUSY`. `bun add -g` **blocks lifecycle scripts** of the package (`Blocked 1 postinstall`), so the CLI's `postinstall` hook can never run; runtime self-heal covers it.
- **Launcher primitives work under Bun on Windows:** `Bun.spawn({ cwd, env, stdio: ["ignore","ignore","pipe"], detached: true, windowsHide: true })` streams stderr, reports `exited`, and with `unref()` the child survives parent exit. `systray2@2.1.4` installs with `bun add`, loads (`require(...).default` is a function) and its `ready()` resolves. A CJS file with a top-level `return` runs under Bun. `bunx --bun eslint` and `bun --bun run eslint` run ESLint 9 on Bun (plain `bunx eslint` obeys the `#!/usr/bin/env node` shebang).
- **Current ESLint config** enables no core `eslint:recommended` rules: 62 rules = 17 `react`, 16 `react-hooks`, 22 `@next`, 6 `jsx-a11y`, 1 `import`. Installed: `eslint@9.39.5`, `@eslint/js@9.39.5`, `eslint-plugin-react@7.37.5`, `eslint-plugin-react-hooks@7.1.1` (flat `configs.flat.recommended-latest`), `globals@14.0.0`.

## Runtime-file inventory (grep `readFileSync|readFile|existsSync|import.meta.url|__dirname|process.cwd()|createRequire` over `src/` and `open-sse/`)

| Reader | What it reads | Resolution in the new build |
|---|---|---|
| `src/shared/constants/providerIconManifest.js` (imported by client code) | generated list of `public/providers/*.png` ids | committed, regenerated by `build.mjs`; CI fails on drift (Task 4) |
| `public/**` (143 provider PNGs, i18n, icons, `sw.js`, `favicon.svg`; 2.4 MB) | served as static files | `compile.assets: ["public"]` in the exe; copied to `dist/app/public` in the bundle; always read as `PUBLIC_DIR` (Task 1) |
| `src/lib/db/version.js` `getAppVersion()` | `process.cwd()/package.json` | JSON import (Task 1) |
| `open-sse/config/appConstants.js` | `createRequire(import.meta.url)("../../package.json")` | JSON import (Task 1) |
| `open-sse/providers/catalogOverride.js`, `src/lib/modelCatalog/sync.js`, `src/app/api/models/catalog-sync/route.js` | `DATA_DIR/model-catalog.json` (runtime data, **not** a build file) | none needed |
| `src/lib/auth/dashboardSession.js`, `src/shared/utils/machineId.js`, `src/lib/db/{backup,migrate,paths}.js`, `headroom/process.js`, `pxpipe/events.js`, `oauth/*/auto-import` | files under `DATA_DIR` / the user's home | none needed |
| `open-sse/executors/devin-cli.js` | writes an `.mjs` MCP script to `os.tmpdir()` and spawns it with `process.execPath` | needs `BUN_BE_BUN=1` (Task 2) |
| `src/lib/pxpipe/install.js` | `npm install pxpipe-proxy` into `DATA_DIR/pxpipe`, then dynamic `import` of it | `bun add` through the exe with `BUN_BE_BUN=1` (Task 2) |
| `open-sse/utils/requestLogger.js`, `open-sse/translator/request/openai-to-commandcode.js` | `process.cwd()/logs`, `process.cwd()` | keep: cwd is `/app` in Docker and `dist/app` for the CLI |
| `src/lib/oauth/services/{oauth,xai}.js` | `import open from "open"` | replaced by a `Bun.spawn` opener (Task 2) |
| `node-machine-id` | reads `/etc/machine-id` or runs `reg`/`ioreg` | bundles and runs (probed) |

---

### Task 1: Bundle-safe runtime paths, app version and version pin

**Files:**
- Create: `src/server/paths.js`
- Modify: `src/lib/db/version.js`, `open-sse/config/appConstants.js:199-209`, `src/shared/constants/config.js:13-15`
- Modify: every place under `src/server/` that resolves `public/` or uses `process.cwd()`/`import.meta.dir` for assets (`rg -n "public|process\.cwd\(\)|import\.meta\.dir" src/server`)
- Test: `tests/unit/bundle-runtime-paths.test.js`, `tests/unit/bun-version-pin.test.js`

**Interfaces:**
- Produces (`src/server/paths.js`):
  - `export const isCompiled: boolean`: true when `import.meta.dir` matches `/\$bunfs|~BUN/`.
  - `export const isBundled: boolean`: `process.env.LITEROUTER_BUNDLED === "1"` (the build sets it with `define`).
  - `export const PUBLIC_DIR: string`: bundled → `join(import.meta.dir, "public")`; source run → `join(import.meta.dir, "..", "..", "public")`; `LITEROUTER_PUBLIC_DIR` overrides.
  - `export function assertBundleCwd(): void`: when `isBundled && !isCompiled && process.cwd() !== import.meta.dir` it throws `Error("[boot] dist/app must run with cwd = its own directory (got <cwd>, expected <dir>); use 'bun run start' or the literouter CLI")`.
- `getAppVersion()` and `getAppPackageVersion()` read `pkg.version` from `import pkg from "../../../package.json" with { type: "json" }` (same pattern as `src/shared/constants/config.js`, `open-sse/shared/clineAuth.js`).

- [ ] **Step 1: Write the failing tests.** `bundle-runtime-paths.test.js`:
  - `"getAppVersion reads the packaged version regardless of cwd"`: `process.chdir(os.tmpdir())`, then `expect(getAppVersion()).toBe(JSON.parse(readFileSync("package.json")).version)`.
  - `"appConstants version is the package version"`: assert the `User-Agent`/version helper that calls `getAppPackageVersion` returns it (`rg -n getAppPackageVersion open-sse` to find the exported consumer; export a tiny `getAppPackageVersion` if none is).
  - `"PUBLIC_DIR points at the repo public dir in a source run"`: `existsSync(join(PUBLIC_DIR, "favicon.svg"))`.
  - `"LITEROUTER_PUBLIC_DIR overrides PUBLIC_DIR"` (dynamic import with a query string after setting the env var).
  - `"assertBundleCwd is a no-op outside a bundle"`.
  - `"no server code resolves public/ from cwd"`: `rg`-style scan of `src/server/**/*.js` asserting none contains `process.cwd()` next to `"public"`.
  `bun-version-pin.test.js`, `"every Bun pin is 1.4.4"`: read root `package.json` `engines.bun`, `cli/package.json` `engines.bun`, every `.github/workflows/*.yml` `bun-version:` line, and `Dockerfile` `ARG BUN_IMAGE=oven/bun:<v>-alpine`; expect all equal `1.4.4` (use `>=1.4.4` only for the root `engines.bun` Plan 1 set and compare its numeric part).
- [ ] **Step 2:** Run `cd tests && bun test unit/bundle-runtime-paths.test.js unit/bun-version-pin.test.js`. Expected: FAIL (no `paths.js`; version `0.0.0` after chdir; Dockerfile still on Node).
- [ ] **Step 3: Implement** `paths.js` as above; switch the two version readers to JSON imports; change `config.js` `npmPackageName: "literouter"`, `installCmd: "bun add -g literouter"`, `installCmdLatest: "bun add -g literouter@latest"`; make the static handler and `spa.js` in `src/server/` use `PUBLIC_DIR`; call `assertBundleCwd()` first in the `import.meta.main` branch of `src/server/index.js`. The pin test only asserts the files that exist at that point (root and `cli/` `package.json`, then each workflow and the Dockerfile once Tasks 7, 9 and 13 create or change them); Task 13 re-runs it against all of them.
- [ ] **Step 4:** Run the same command. Expected: PASS for `bundle-runtime-paths`; `bun-version-pin` passes for the files that exist. Then `cd tests && bun test unit/ -t "version"`. Expected: PASS (other version tests unaffected).
- [ ] **Step 5: Commit.** `fix(server): resolve version and public dir without cwd so bundles and executables work`

### Task 2: Subprocesses on the embedded Bun, and the `open` replacement

**Files:**
- Create: `src/lib/runtimeBun.js`, `src/lib/openUrl.js`
- Modify: `open-sse/executors/devin-cli.js:140-148`, `src/lib/pxpipe/install.js` (`findNpm`, `runInstall`, `EXTRA_BINS`), `src/lib/oauth/services/oauth.js:1`, `src/lib/oauth/services/xai.js:1`
- Test: `tests/unit/runtime-bun.test.js`; `tests/unit/open-package-external.test.js` is **replaced** by `tests/unit/open-url.test.js` (3 → ≥3 cases); extend `tests/unit/devin-cli-executor.test.js` and `tests/unit/pxpipe.test.js` only where they assert the exact env object (case counts unchanged)

**Interfaces:**
- `runtimeBun.js`: `export function bunCommand() → { command: string, env: { BUN_BE_BUN: "1" } }`, with `command = process.execPath`. In a compiled executable this is the app itself, which acts as the `bun` CLI when `BUN_BE_BUN=1`.
- `openUrl.js`: `export function openUrl(url: string, spawn = Bun.spawn) → void`. It validates `/^https?:\/\//` (throws `Error("openUrl: only http(s) URLs")` otherwise) and spawns `open <url>` on darwin, `cmd /c start "" <url>` on win32, `xdg-open <url>` elsewhere, detached and unref'd, errors swallowed.
- `devin-cli.js` MCP block becomes `{ command: bunCommand().command, args: [script], env: { ...bunCommand().env, DEVIN_MCP_TOOLS, ... } }`.
- `pxpipe/install.js`: `findNpm()` keeps its name and export (`service.js` and the dashboard's `npmAvailable` field depend on it) and now returns `bunCommand().command`. `runInstall` spawns `[command, "add", "pxpipe-proxy@latest"]` with `env: { ...process.env, ...bunCommand().env }` and cwd `PXPIPE_DIR`; the log line and the two error messages say `bun add`; the `NPM_NOT_FOUND` code is kept.

- [ ] **Step 1: Write the failing tests.**
  - `runtime-bun.test.js`: `"bunCommand sets BUN_BE_BUN and points at the current executable"`: `expect(bunCommand()).toEqual({ command: process.execPath, env: { BUN_BE_BUN: "1" } })`. `"BUN_BE_BUN executable runs -e"`: `Bun.spawnSync([process.execPath, "-e", "process.exit(2)"], { env: { ...process.env, BUN_BE_BUN: "1" } }).exitCode === 2`.
  - `open-url.test.js` (replaces the three `serverExternalPackages` cases): `"rejects non-http urls"`, `"uses xdg-open on linux"`, `"uses cmd /c start on win32"` (inject a fake `spawn`; override `process.platform` with `Object.defineProperty`), and `"no source file imports the open package"`: scan `src` and `open-sse` for `from "open"` and expect none.
  - `devin-cli-executor.test.js` (existing): the MCP server entry's `env.BUN_BE_BUN` is `"1"`.
  - `pxpipe.test.js` (existing): install spawns `[process.execPath, "add", "pxpipe-proxy@latest"]` with `BUN_BE_BUN` set (use the file's existing spawn mock).
- [ ] **Step 2:** Run `cd tests && bun test unit/runtime-bun.test.js unit/open-url.test.js unit/devin-cli-executor.test.js unit/pxpipe.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above. Remove the `"open"` entry from consideration in `package.json` only in Task 14. Delete `tests/unit/open-package-external.test.js` in this commit and move its key in `test-counts.json` to `open-url.test.js` with count ≥ 3.
- [ ] **Step 4:** Rerun Step 2's command. Expected: PASS. Then `rg "from ['\"]open['\"]" src open-sse`. Expected: no output.
- [ ] **Step 5: Commit.** `fix(runtime): spawn the embedded Bun with BUN_BE_BUN and replace open with Bun.spawn`

### Task 3: System CA trust on Bun (fail-closed, applied to every fetch)

**Files:**
- Create or modify: `src/server/ca.js` (Plan 2 deleted `custom-server.js`; if it already moved `useSystemCaStore` here, keep its signature and add the new function)
- Modify: `src/server/index.js` main branch (call it before `startServer`), `tests/unit/system-ca-trust.test.js` (**rewritten in place**, 5 → ≥5 cases)

**Interfaces:**
- `export function useSystemCaStore(tlsApi = tls, fetchHost = globalThis) → number`: reads `tlsApi.getCACertificates("system")`; throws `Error("CA trust: system CA store is empty or unreadable; refusing to fall back to the bundled roots")` when empty; calls `tlsApi.setDefaultCACertificates(system)` (covers `node:tls`/`node:https`/`node:http2` clients such as the Cursor executor); replaces `fetchHost.fetch` with a wrapper that adds `tls: { ca: system, ...init?.tls }` to every call unless the caller passed its own `tls.ca`; returns `system.length`.
- Called from the main branch only when `process.env.LITEROUTER_SYSTEM_CA === "1"`; on throw it logs the message and exits 1 (same as today).

- [ ] **Step 1: Write the failing tests** (rewrite `system-ca-trust.test.js`, keep `makeChain` with `openssl` generated at test time; no committed key material):
  - `"installs the system certs as the process default"`: fake `tlsApi`, expect return `2` and one `setDefaultCACertificates(["a","b"])` call.
  - `"fails closed on an empty system store"`: expect `toThrow(/refusing/)` and that `setDefaultCACertificates` was never called.
  - `"is enabled in the production image"`: Dockerfile matches `/^ENV LITEROUTER_SYSTEM_CA=1$/m`.
  - `"global fetch accepts a chain rooted in the configured store"` and `"global fetch rejects a chain whose root is not in the configured store"` (error matches `UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT`): spawn `process.execPath` with a small script that starts a `Bun.serve({ tls })`, calls `useSystemCaStore({ getCACertificates: () => [trustedCa], setDefaultCACertificates: tls.setDefaultCACertificates })`, then `fetch`es it. Run in a child so the global patch cannot leak.
  - Additional: `"node:https clients honour the replaced default list"` (same child, `https.get`), keeping the old test's third client. The old `undici` client assertion is replaced by this one; the PR lists `undici client → fetch + node:https`.
  - `"a caller-supplied tls.ca is not overridden"`.
- [ ] **Step 2:** Run `cd tests && bun test unit/system-ca-trust.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `useSystemCaStore` as specified; wire it into the main branch.
- [ ] **Step 4:** Rerun. Expected: PASS (≥ 5 cases). Update `test-counts.json` if the count changed.
- [ ] **Step 5: Commit.** `fix(security): keep the OS CA bundle authoritative for Bun fetch and node:tls`

### Task 4: `scripts/build.mjs`, public assets and the icon manifest

**Files:**
- Create: `scripts/build.mjs`; Modify: `scripts/gen-provider-icon-manifest.mjs`, `package.json` scripts, `.gitignore` (add `/dist/`)
- Delete: `scripts/copy-standalone-assets.mjs`; `tests/unit/standalone-assets.test.js` is **replaced** by `tests/unit/build-assets.test.js` (4 → ≥4 cases)
- Test: `tests/unit/build-assets.test.js`, `tests/unit/provider-icon-manifest.test.js`, `tests/server/bundle-cwd.test.js`

**Interfaces:**
- `scripts/build.mjs` exports and runs as `bun scripts/build.mjs [--compile <target>] [--outdir <dir>]`:
  - `export async function buildApp({ root = repoRoot, outdir = "dist/app", entry = "src/server/index.js" } = {}) → Promise<{ outdir: string, files: string[] }>`: regenerates the icon manifest, then `Bun.build({ entrypoints: [entry], target: "bun", root, outdir, minify: true, sourcemap: "none", publicPath: "/", plugins: [tailwind], define: { "process.env.LITEROUTER_BUNDLED": '"1"' }, naming: { entry: "[name].[ext]", chunk: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" } })`; throws listing `logs` when `success` is false; copies `public/` to `<outdir>/public` with `cpSync`. Output: `<outdir>/index.js` (server entry) plus the SPA files.
  - `export async function compileApp({ target, root = repoRoot, outfile = "dist/bin/literouter-<target>", entry } = {}) → Promise<string>`: same options plus `compile: { target, outfile, assets: ["public"], autoloadBunfig: false }`, `naming.asset "[dir]/[name].[ext]"` is **not** used. Allowed targets: `bun-linux-x64-musl`, `bun-linux-arm64-musl` (anything else throws `Error("unsupported compile target: <t>")`).
  - Leaves the root `package.json` untouched.
- `gen-provider-icon-manifest.mjs`: `export function generateProviderIconManifest({ root }) → string` (the file text); the CLI entry writes `src/shared/constants/providerIconManifest.js` under `import.meta.main`.
- `package.json` scripts: `"dev": "bun --hot src/server/index.js"`, `"build": "bun scripts/build.mjs"`, `"compile": "bun scripts/build.mjs --compile bun-linux-x64-musl"`, `"compile:arm64": "bun scripts/build.mjs --compile bun-linux-arm64-musl"`, `"start": "cd dist/app && bun index.js"`, `"lint": "bun --bun run eslint ."`, `"test": "cd tests && bun test --parallel"`, `"cli:pack": "cd cli && bun run pack:cli"`, `"cli:publish": "cd cli && bun run publish:cli"`; remove every `pre*`/`post*`/`*:bun`/`*:webpack` script (the manifest is generated inside `buildApp`).

- [ ] **Step 1: Write the failing tests.**
  - `build-assets.test.js` (fixture project in a temp dir with `src/server/index.js` that `export`s a `startServer`, `src/web/index.html`, `public/favicon.svg`, `package.json`): `"copies public assets next to the bundle"` (`<outdir>/public/favicon.svg` content equals the source), `"honours a custom outdir"`, `"emits the server entry as index.js with LITEROUTER_BUNDLED inlined"` (the bundle text contains `"1"` where `isBundled` is defined and `existsSync(outdir/index.js)`), `"does not modify the root package.json"` (bytes equal before and after).
  - `provider-icon-manifest.test.js`: `"manifest text matches the committed file"` (`generateProviderIconManifest({root})` equals `readFileSync("src/shared/constants/providerIconManifest.js")`), `"ids are sorted and unique"`.
  - `bundle-cwd.test.js` (in `tests/server/`, builds the real app once in `beforeAll` into a temp outdir): `"runs from its own directory"` (spawn `bun index.js` with cwd = outdir, `PORT=0`-style free port, `DATA_DIR` temp, expect `/api/health` 200 within 15 s, then kill) and `"refuses to run from another cwd"` (spawn `bun <abs>/index.js` with cwd = tmp; expect exit code 1 and stderr containing `must run with cwd`). Hook timeout 120 s for the build (this is the one place a per-test timeout above 5000 ms is justified; comment it).
- [ ] **Step 2:** Run `cd tests && bun test unit/build-assets.test.js unit/provider-icon-manifest.test.js server/bundle-cwd.test.js`. Expected: FAIL (`scripts/build.mjs` missing).
- [ ] **Step 3: Implement** `buildApp`, `compileApp`, the CLI wrapper (`if (import.meta.main)`), the manifest refactor and the `package.json` scripts; add `bun-plugin-tailwind` use exactly as Plan 3 configured it in `bunfig.toml` (`rg -n "tailwind" bunfig.toml src/web`); `git rm scripts/copy-standalone-assets.mjs tests/unit/standalone-assets.test.js`; update `test-counts.json` (`standalone-assets` → `build-assets`).
- [ ] **Step 4:** Rerun Step 2's command. Expected: PASS. Then `bun run build && ls dist/app`. Expected: `index.js`, `index.html`, hashed `.js`/`.css`, `public/`. Then `bun run start` and `curl -s localhost:20128/api/health`. Expected: `200`. Record `du -sm dist/app` in the PR; Task 13 uses `30` MiB as the initial ceiling (raise only with a reason).
- [ ] **Step 5: Commit.** `build: Bun.build bundle and compile targets, replace Next standalone assets`

### Task 5: Compile smoke (`scripts/smoke-server.mjs`) and the executable

**Files:**
- Create: `scripts/smoke-server.mjs`; Test: `tests/server/smoke-script.test.js`

**Interfaces:**
- `export async function runSmoke({ base, password = "smoke-pass" }) → Promise<{ health: number, dashboard: number, chat: number, chatText: string }>`. It starts an in-process `Bun.serve` mock upstream on `127.0.0.1:0` (an OpenAI-compatible `/v1/chat/completions` JSON answer `"smoke-ok"`), logs in with `POST /api/auth/login`, provisions through the same endpoints `scripts/bench/mock-suite.mjs` uses (`/api/provider-nodes`, `/api/providers`, `/api/keys`), then calls `GET /api/health`, `GET /dashboard` with the cookie, and `POST /v1/chat/completions` with the key. Throws on any non-2xx.
- CLI: `bun scripts/smoke-server.mjs --base <url>` or `--spawn <dir-with-index.js | executable>` (spawns it with temp `DATA_DIR`, `INITIAL_PASSWORD`, `JWT_SECRET`, `API_KEY_SECRET`, `MACHINE_ID_SALT`, `AUTH_COOKIE_SECURE=false`, a free `PORT`, `HOSTNAME=127.0.0.1`, cwd = the directory for a bundle, then kills it). Requests come from loopback, so provider-node validation treats the operator as local, as in the benchmark suite.

- [ ] **Step 1: Write the failing test.** `smoke-script.test.js`: `"smoke passes against the source server"`: `startServer({ port: 0, hostname: "127.0.0.1" })` with temp `DATA_DIR` and `INITIAL_PASSWORD=smoke-pass`, `runSmoke({ base })` resolves `{ health: 200, dashboard: 200, chat: 200, chatText: "smoke-ok" }`; `server.stop(true)` in `afterAll`. `"smoke fails loudly when /v1 is broken"`: point `base` at a `Bun.serve` that answers 500 to `/v1/*`; expect rejection mentioning `/v1/chat/completions`.
- [ ] **Step 2:** Run `cd tests && bun test server/smoke-script.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `runSmoke` and the CLI (spawning uses `Bun.spawn`; wait for `/api/health` with a 30 s deadline).
- [ ] **Step 4:** Rerun. Expected: PASS. Then `bun scripts/smoke-server.mjs --spawn dist/app` after `bun run build`. Expected: prints `smoke ok: health=200 dashboard=200 chat=200`. Then build the exe: `bun scripts/build.mjs --compile bun-linux-x64-musl && ls -l dist/bin`. Expected: `literouter-bun-linux-x64-musl`, 100–125 MB; and `bun scripts/build.mjs --compile bun-linux-arm64-musl` produces the arm64 file. (The musl exe is exercised in Docker in Task 7; it cannot run on a glibc or Windows host.)
- [ ] **Step 5: Commit.** `test: end-to-end smoke script for bundle and executable`

### Task 6: Image-size gate script

**Files:**
- Create: `scripts/check-image-size.mjs`; Test: `tests/unit/check-image-size.test.js`

**Interfaces:**
- `export function assertImageSize(sizeBytes: number, maxMb: number): { mb: number }` (MB = 1,000,000 bytes, matching `docker image ls`): throws `Error("image is <mb> MB, limit <max> MB")` when over.
- CLI `bun scripts/check-image-size.mjs <image> [--max-mb 150]` runs `docker image inspect <image> --format {{.Size}}` and prints `size_mb=<n>`; exit 1 over the limit.

- [ ] **Step 1: Write the failing tests.** `"passes at the limit and fails one byte over"` (`assertImageSize(150_000_000, 150)` ok, `150_000_001` throws), `"reports MB with one decimal"`, `"rejects non-numeric size"`.
- [ ] **Step 2:** Run `cd tests && bun test unit/check-image-size.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** both exports.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5: Commit.** `ci: image size gate script`

### Task 7: Dockerfile, `.dockerignore`, compose and deploy files

**Files:**
- Modify: `Dockerfile` (rewrite), `.dockerignore`, `compose.production.yml`
- Audit, no change expected: `docker-compose.yml`, `captain-definition`, `start.sh`, `scripts/deploy.sh`, `scripts/post-deploy.sh` (none reference `node`, `next` or `custom-server.js`; `NODE_ENV: production` stays)
- Create: `scripts/smoke-image.mjs`; Test: `tests/unit/docker-files.test.js`; extend `tests/unit/deploy-script.test.js` (+1 case, existing 10 untouched)

**Interfaces:**
- Dockerfile (exact decisions; the implementer writes the commands):
  - `# syntax=docker/dockerfile:1.7`; `ARG BUN_IMAGE=oven/bun:1.4.4-alpine`; `ARG ALPINE_IMAGE=alpine:3.22`.
  - **builder:** `FROM --platform=$BUILDPLATFORM ${BUN_IMAGE}`; `ARG TARGETARCH`; `COPY package.json bun.lock ./`; `bun install --frozen-lockfile` (keep the `registry.npmmirror.com` registry through `ENV BUN_CONFIG_REGISTRY` as the old `npm ci` did); `COPY . ./`; map `amd64 → bun-linux-x64-musl`, `arm64 → bun-linux-arm64-musl`, any other arch fails the build; `bun scripts/build.mjs --compile "$target"`; copy to `/out/literouter`. Building on the build platform and cross-compiling means arm64 needs no QEMU during the build.
  - **runner:** `FROM ${ALPINE_IMAGE}`; keep the aliyun `sed` on `/etc/apk/repositories`; `apk --no-cache upgrade && apk --no-cache add libstdc++ libgcc ca-certificates su-exec`; `addgroup -g 1000 -S literouter && adduser -S -u 1000 -G literouter -h /home/literouter literouter` (uid/gid 1000 = the old `node` user, so existing volume files stay owned correctly); `COPY --from=builder /out/literouter /app/literouter`; `ENV NODE_ENV=production PORT=20128 HOSTNAME=0.0.0.0 DATA_DIR=/app/data LITEROUTER_SYSTEM_CA=1`; `mkdir -p /app/data /app/data-home`, `chown -R literouter:literouter /app`, `ln -sf /app/data-home /root/.9router 2>/dev/null || true` (unchanged); entrypoint printed as before with `su-exec literouter "$@"` and `chown -R literouter:literouter /app/data /app/data-home`; `EXPOSE 20128`; `ENTRYPOINT ["/entrypoint.sh"]`; `CMD ["/app/literouter"]`; keep `LABEL org.opencontainers.image.title="LiteRouter"`. No `NEXT_TELEMETRY_DISABLED`, no `node` anywhere.
- `.dockerignore`: add `tests`, `docs`, `images`, `bench-results`, `.claude`, `.rig`, `cli/app` (keep existing entries).
- `compose.production.yml`: healthcheck becomes `test: [CMD, env, BUN_BE_BUN=1, /app/literouter, -e, "fetch('http://127.0.0.1:20128/api/auth/status').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"]` (same URL, same `<500` rule, same interval/timeout/retries/start_period); delete `NODE_OPTIONS` and replace its comment with: `# #147: V8's --max-old-space-size does not apply on Bun (JavaScriptCore). The ceiling is mem_limit; BUN_OPTIONS=--smol is the opt-in knob if Plan 5's RSS gate needs it.`
- `scripts/smoke-image.mjs <image> [--platform linux/arm64]`: `docker run -d --platform P -e DATA_DIR=/app/data -e INITIAL_PASSWORD=smoke-pass -e JWT_SECRET=... -e API_KEY_SECRET=... -e MACHINE_ID_SALT=... -e AUTH_COOKIE_SECURE=false <image>`; waits for `/api/health` by running `docker exec -e BUN_BE_BUN=1 <c> /app/literouter -e "<the healthcheck js>"`; asserts the server process runs as `literouter` (`docker exec <c> ps -o user=,args=`); copies `scripts/smoke-server.mjs` in with `docker cp` and runs `docker exec -e BUN_BE_BUN=1 <c> /app/literouter /tmp/smoke-server.mjs --base http://127.0.0.1:20128` (so the requests are loopback and the mock upstream lives in the container); always `docker rm -f` the container.

- [ ] **Step 1: Write the failing tests.**
  - `docker-files.test.js`: `"Dockerfile has no node or next"` (no `/\bnode\b/` match other than the comment-free file; no `next`/`custom-server`), `"runtime base is alpine with the required packages"`, `"user is uid and gid 1000"` (`/adduser .*-u 1000/` and `addgroup -g 1000`), `"keeps the volume and CA contract"` (`/app/data`, `/app/data-home`, `PORT=20128`, `HOSTNAME=0.0.0.0`, `LITEROUTER_SYSTEM_CA=1`, `ln -sf /app/data-home /root/.9router`), `"build stage uses the pinned Bun image and both musl targets"`, `"compose.production healthcheck uses BUN_BE_BUN and no node"`, `"compose.production has no NODE_OPTIONS"`, `"deploy files do not reference node, next or custom-server"` (scan `docker-compose.yml`, `captain-definition`, `start.sh`, `scripts/deploy.sh`, `scripts/post-deploy.sh`).
  - `deploy-script.test.js`: `"refuses to deploy over a running staging image"`: fake docker reports `ghcr.io/raufimusaddiq/literouter-staging:staging-<sha>`; expect exit 1, output `is not on ghcr.io/raufimusaddiq/literouter-production`, and no `compose` call in the log.
- [ ] **Step 2:** Run `cd tests && bun test unit/docker-files.test.js unit/deploy-script.test.js`. Expected: FAIL (Dockerfile still on Node).
- [ ] **Step 3: Implement** the Dockerfile, `.dockerignore`, `compose.production.yml` and `scripts/smoke-image.mjs`.
- [ ] **Step 4:** Rerun Step 2. Expected: PASS (deploy-script: 11 cases). Then, with Docker available:
  `docker buildx build --platform linux/amd64 --load -t literouter:local .` then `bun scripts/check-image-size.mjs literouter:local --max-mb 150`. Expected: `size_mb` about 115–125, exit 0. Then `bun scripts/smoke-image.mjs literouter:local`. Expected: `smoke ok`. Then `docker run --rm literouter:local sh -c 'ls /usr/share/zoneinfo; env BUN_BE_BUN=1 TZ=Asia/Jakarta /app/literouter -e "console.log(new Date(0).getHours())"'`. Expected: `7` (no tzdata needed). The arm64 image builds locally (`--platform linux/arm64 --load`) but is only run in CI under QEMU.
- [ ] **Step 5: Commit.** `build(docker): Alpine image with the compiled Bun executable, multi-arch, healthcheck without node`

### Task 8: ESLint flat config without `eslint-config-next`

**Files:**
- Modify: `eslint.config.mjs` (rewrite), `package.json` devDependencies (add `@eslint/js`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `globals`; `eslint-config-next` is removed in Task 14)
- Test: `tests/unit/eslint-config.test.js`

**Interfaces:** the config exports an array built from: `js.configs.recommended` with every rule that fails on today's code downgraded to `"warn"`; `react.configs.flat.recommended` and `react.configs.flat["jsx-runtime"]` with `settings.react.version = "detect"`; `reactHooks.configs.flat["recommended-latest"]`; the six React Compiler rules (`set-state-in-effect`, `immutability`, `rules-of-hooks`, `refs`, `purity`, `preserve-manual-memoization`) set to `"warn"` exactly as today; `languageOptions.globals` = `globals.browser` + the server identifiers (`globals.node`, which is only a list of global names for ESLint, plus `Bun: "readonly"`), with `parserOptions.ecmaFeatures.jsx`; ignores: `dist/**`, `cli/app/**`, `.claude/**`, `.rig/**`, `node_modules/**`. Dropped with `eslint-config-next`: the 22 `@next/*` rules, 6 `jsx-a11y` rules and the `import` rule (none apply once Next is gone; noted in the CHANGELOG).

- [ ] **Step 1: Write the failing test** (`eslint-config.test.js`, uses `new ESLint({ cwd: root }).calculateConfigForFile("src/shared/components/Badge.js")`): `"has no @next rules"` (no key starts with `@next/`), `"React Compiler rules are warnings"` (each of the six equals `1` or `"warn"`), `"exhaustive-deps is a warning"`, `"react/jsx-key is an error"` (the 17-rule `react` set is intact: `react/jsx-key`, `react/no-unescaped-entities`, `react/jsx-no-undef` are `2`), `"package.json has no eslint-config-next"` (checked after Task 14; assert on `eslint.config.mjs` text not importing it now).
- [ ] **Step 2:** Run `cd tests && bun test unit/eslint-config.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the config. Then run `bun --bun run eslint . --format json -o ../eslint-out.json` once and list the rules that produce **errors**; set each of those core rules to `"warn"` in a block commented `// Debt: no pre-existing core rules were enforced under eslint-config-next; warn until cleared, then delete`. Do not fix source files in this task.
- [ ] **Step 4:** Run `bun --bun run eslint .`. Expected: exit 0 (warnings allowed, 0 errors), and `bun test unit/eslint-config.test.js` PASS.
- [ ] **Step 5: Commit.** `chore(lint): flat ESLint config on @eslint/js, react and react-hooks, no eslint-config-next`

### Task 9: CLI package rename and Bun-only metadata

**Files:**
- Modify: `cli/package.json`, `cli/cli.js:1-20,92-110`, `src/shared/constants/config.js` (done in Task 1), `cli/README.md` (install and usage sections only)
- Create: `cli/hooks/runtimeDir.js`
- Delete: `cli/hooks/sqliteRuntime.js`, `cli/hooks/postinstall.js`
- Modify: `cli/src/cli/utils/serverProc.js:5`, `cli/src/cli/tray/tray.js` (two `require("../../../hooks/sqliteRuntime")`), `cli/hooks/trayRuntime.js:11`
- Test: `cli/test/package.test.js`

**Interfaces:**
- `cli/package.json`: `"name": "literouter"`, `"bin": { "literouter": "./cli.js" }`, `"engines": { "bun": "1.4.4" }`, `"files"` unchanged, scripts `dev: "bun --watch cli.js"`, `build: "bun scripts/build-cli.js"`, `test: "bun test"`, `pack:cli: "bun run build && bun pm pack --destination .."`, `publish:cli: "bun run build && bun publish"`, `prepublishOnly: "bun run build"`; **no `postinstall`** (Bun blocks it for global installs, probed); drop `nodemon` and both `comment_*` keys; keywords `literouter`; `dependencies` keeps `node-machine-id`. Version stays as is; Plan 5 bumps it at release.
- `runtimeDir.js` (moved verbatim from `sqliteRuntime.js`): `getDataDir()`, `getRuntimeDir()`, `getRuntimeNodeModules()`, `ensureRuntimeDir() → string`. Package name in the runtime `package.json` stays `9router-runtime` (existing dirs keep working).
- `cli.js` top: shebang `#!/usr/bin/env bun`; immediately `if (typeof Bun === "undefined" || compareVersions(Bun.version, "1.4.4") < 0) { console.error("literouter requires Bun >= 1.4.4 (https://bun.sh)"); process.exit(1); }` (move `compareVersions` above it as a hoisted function declaration). `UPDATE_PACKAGE = (process.env.NINEROUTER_UPDATE_PACKAGE ?? pkg.name).trim()` (set the env var to an empty string to disable the check; **behaviour change**: the update check is now on by default because the package is published), `INSTALL_CMD_LATEST = \`bun add -g ${UPDATE_PACKAGE}@latest\``; the registry probe uses `fetch("https://registry.npmjs.org/<pkg>/latest", { signal: AbortSignal.timeout(3000) })` instead of `https.get`. User-visible `9Router`/`9router` display strings become `LiteRouter`/`literouter`; **unchanged:** `~/.9router`, `NINEROUTER_*`, the autostart file names and label (`9router.vbs`, `9router.desktop`, `com.9router.autostart`, so legacy entries are overwritten, not duplicated), `[9router]` is renamed only in user-facing messages.

- [ ] **Step 1: Write the failing test** (`cli/test/package.test.js`, `bun:test`): `"package is literouter with a literouter bin"`, `"is Bun-only"` (`engines.bun === "1.4.4"`, no `engines.node`, `cli.js` first line `#!/usr/bin/env bun`), `"has no lifecycle install hooks"` (no `postinstall`), `"help output names literouter"` (`Bun.spawnSync([process.execPath, "cli.js", "--help"], { cwd: cliDir, env: { ...process.env, NINEROUTER_UPDATE_PACKAGE: "" } })` stdout contains `Usage: literouter`), `"update command is bun add -g"` (the `--help` run is not enough: export `INSTALL_CMD_LATEST` through a small `cli/src/cli/utils/update.js` `buildInstallCmd(pkgName) → string` and assert `bun add -g literouter@latest`).
- [ ] **Step 2:** Run `cd cli && bun test test/package.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the metadata, `runtimeDir.js`, import rewrites, deletions and the display-string rename (`rg -n "9Router|9router" cli --glob '!cli/test/**'` and change only user-facing strings).
- [ ] **Step 4:** Rerun. Expected: PASS. `rg "sqliteRuntime|postinstall" cli --glob '!cli/test/**'` prints nothing.
- [ ] **Step 5: Commit.** `feat(cli)!: rename to literouter, Bun-only package, drop sqlite runtime and postinstall`

### Task 10: CLI launches `dist/app` with the user's Bun

**Files:**
- Modify: `cli/scripts/build-cli.js` (rewrite), `cli/cli.js` (`spawnServer`, hide-to-tray spawn, `serverPath`, restricted-environment text)
- Test: `tests/unit/cli-build.test.js` (**replaces** `tests/unit/cli-build-artifacts.test.js`, 3 → ≥3 cases), `cli/test/spawn.test.js`

**Interfaces:**
- `build-cli.js` exports `copyAppBundle(distAppDir, cliAppDir) → void` (recursive copy; skips `*.map`, `.env*`, `*.log`), `assertRequiredArtifacts(cliAppDir) → void` (throws `Error("Required CLI app artifact(s) missing:\n<paths>")` listing every missing path among `index.js`, `index.html`, `public/favicon.svg`), `async function buildCliPackage({ rootDir, cliAppDir })`: (0) sync the CLI version into the root `package.json` as today, (1) `Bun.spawn([process.execPath, "scripts/build.mjs"], { cwd: rootDir })` must exit 0, (2) remove `cli/app`, (3) `copyAppBundle(dist/app, cli/app)`, (4) `assertRequiredArtifacts`, (5) print the size. No `.build-home`, `NEXT_*`, standalone, vendor-chunks, sql.js or `open` handling remains. Main under `if (require.main === module)`.
- `cli.js`: `serverPath = path.join(__dirname, "app", "index.js")`, message `Error: app bundle not found. Run 'bun run build' in cli/ first.`; `spawnServer()` uses `Bun.spawn([RUNTIME, "--dns-result-order=ipv4first", serverPath], { cwd: appDir, stdio: showLog ? ["inherit","inherit","inherit"] : ["ignore","ignore","pipe"], detached: true, windowsHide: true, env: { ...process.env, PORT, HOSTNAME } })` (`--max-old-space-size=6144` is dropped: Bun ignores it; `--dns-result-order` is kept, it works on Bun). It reads stderr from `proc.stderr` into `crashLog` (last 50 lines), `proc.pid` goes to `writeServerPid`, and `proc.exited.then(code => ...)` replaces the `close` handler with the same restart logic (`MAX_RESTARTS`, backoff). Hide-to-tray respawn: `Bun.spawn([process.execPath, "--dns-result-order=ipv4first", __filename, ...buildTrayArgs({host, port})], { detached: true, stdio: ["ignore","ignore","ignore"], windowsHide: true, env: {...} }).unref()`. No `NODE_PATH` is injected. cwd is the app directory, as it was for the standalone build, which satisfies Review Focus 1.

- [ ] **Step 1: Write the failing tests.**
  - `cli-build.test.js` (replaces the three `merges ...` cases, fixture `dist/app` in a temp dir): `"copies the app bundle and public assets into cli/app"`, `"copy is idempotent and keeps files from an earlier run"`, `"reports the missing required artifact path"` (message lists the exact path), plus `"skips source maps and env files"`.
  - `cli/test/spawn.test.js`: `"server child runs with cwd = app dir and the Bun flags we keep"` using a fake app dir whose `index.js` prints `process.cwd()`, `Bun.version` and `process.argv` to stderr then idles; spawn through an exported `buildServerSpawn({ runtime, serverPath, appDir, port, host, showLog }) → [cmd[], options]` and assert `cmd` is `[runtime, "--dns-result-order=ipv4first", serverPath]`, `cmd` has no `--max-old-space-size`, `options.cwd === appDir`, `options.env.PORT === "20128"`, `options.env.NODE_PATH` is `undefined`.
- [ ] **Step 2:** Run `cd tests && bun test unit/cli-build.test.js` and `cd cli && bun test test/spawn.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the build script and `buildServerSpawn`, rewire `spawnServer` and the hide-to-tray spawn; `git rm tests/unit/cli-build-artifacts.test.js`; update `test-counts.json`.
- [ ] **Step 4:** Rerun both. Expected: PASS. Then `cd cli && bun run build && cd .. && ls cli/app`. Expected: `index.js index.html public ...`. Then `cd cli && bun cli.js --no-browser --skip-update -p 20141 &`, `curl -s localhost:20141/api/health` returns 200, and `bun scripts/smoke-server.mjs --base http://127.0.0.1:20141` prints `smoke ok`; stop with SIGINT and check `~/.9router/server.pid` is gone.
- [ ] **Step 5: Commit.** `feat(cli): bundle dist/app and launch it with the user's Bun via Bun.spawn`

### Task 11: Runtime self-heal for the tray, and the old-CLI takeover

**Files:**
- Modify: `cli/hooks/runtime.js` (rewrite), `cli/hooks/trayRuntime.js`, `cli/cli.js` (`claimPort`), `cli/src/cli/tray/autostart.js` (`getCliJsPath` only if it assumes Node)
- Create: `cli/src/cli/utils/legacyCli.js`
- Test: `cli/test/runtime.test.js`, `cli/test/legacyCli.test.js`

**Interfaces:**
- `runtime.js`: `export`s (CJS `module.exports`) `async function ensureRuntime({ silent = true } = {}) → { skipped?: "ready"|"backoff"|"locked"|"windows", ok?: boolean, reason?: string }`, `buildBunAddArgs(packages: {name,version}[]) → string[]` (`["add", "systray2@2.1.4"]`), `summarizeBunError(stderr: string) → string`, `backoffMs(failures: number) → number` (5 min doubling to 24 h cap), `isInBackoff(now?: number) → boolean`. It keeps the lock file and `.install-failed` marker behaviour of the old `sqliteRuntime.js`, runs `Bun.spawn([process.execPath, ...buildBunAddArgs(pkgs)], { cwd: ensureRuntimeDir(), stdio: ["ignore","ignore","pipe"], windowsHide: true })` with the same 180 s timeout, and on non-Windows installs only `systray2@2.1.4`. `chmodSystrayBin` and `cleanupLegacySystray` from `trayRuntime.js` stay; their comments that say `npm tarball` are reworded to `package` so the Task 14 gate passes.
- `legacyCli.js`:
  - `isLegacyNodeProcess(cmdline: string) → boolean`: true when the command line contains a `node`/`node.exe` executable and a `9router` path segment and one of `custom-server.js`, `server.js`, `cli.js`.
  - `isLegacyLauncher(cmdline: string) → boolean`: same but requires `9router[\\/]cli.js`.
  - `async function getProcessInfo(pid: number) → { ppid: number | null, cmdline: string } | null`: win32 `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=<pid>') | % { \"$($_.ParentProcessId)|$($_.CommandLine)\" }"`, unix `ps -o ppid=,args= -p <pid>`; returns `null` on any failure.
  - `async function stopLegacyServer(deps) → { stopped: boolean, launcherPid?: number, serverPid?: number }` with `deps = { readServerPid, getListenerPid, isTrackedServerAlive, getProcessInfo, kill, sleep, log }`: reads the pidfile record; returns `{ stopped: false }` when there is no record, when `isTrackedServerAlive(record.pid, getListenerPid(record.port))` is false (stale), or when the server's command line is not `isLegacyNodeProcess`. Otherwise it reads the parent, **kills the parent first when `isLegacyLauncher`** (unix `SIGTERM`, win32 `taskkill /F /PID`), waits up to 2 s for the listener to disappear, then kills the server pid if it is still the listener, and logs `Stopped the server started by the old 9router CLI (pid N). Run 'npm rm -g 9router'.`
- `cli.js` `claimPort()` calls `stopLegacyServer` first. If it stopped something **and** `isAutoStartEnabled()`, call `enableAutoStart(__filename, { host, port })` so the old `node`-based autostart entry is rewritten to the Bun launcher.

- [ ] **Step 1: Write the failing tests.**
  - `runtime.test.js`: `"backoff doubles from five minutes and caps at 24 hours"` (`backoffMs(1) === 300000`, `backoffMs(2) === 600000`, `backoffMs(20) === 86400000`), `"installs only systray2 on linux and macos"` (`buildBunAddArgs` result and `getTrayPackages()` with `process.platform` overridden), `"installs nothing on windows"`, `"summarizes network, permission and disk errors"`, `"a failed install records a marker and the next call is in backoff"` (temp `DATA_DIR`, inject a spawn that exits 1).
  - `legacyCli.test.js`: `"recognizes the old node server command line"` (`C:\Program Files\nodejs\node.exe --dns-result-order=ipv4first --max-old-space-size=6144 C:\Users\u\AppData\Roaming\npm\node_modules\9router\app\custom-server.js` true), `"does not treat a bun literouter server as legacy"` (`bun ...\literouter\app\index.js` false), `"does not treat an unrelated node process as legacy"`, `"kills the legacy launcher before its server"` (fakes record call order `["launcher", "server"]`), `"kills only the server when its parent is not the launcher"`, `"leaves a new-CLI server to the normal claimPort path"` (`stopped: false`, `kill` not called), `"ignores a stale pidfile"` (listener pid differs), `"does nothing without a pidfile"`, `"refreshes autostart only when something was stopped"` (inject `enableAutoStart` into a thin `takeoverLegacy(deps)` wrapper, assert 0 calls in the not-stopped cases and 1 call with `{ host, port }` when stopped).
- [ ] **Step 2:** Run `cd cli && bun test test/runtime.test.js test/legacyCli.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** both modules and wire `claimPort`. `cli/src/cli/tray/tray.js` keeps requiring `systray2` from `getRuntimeNodeModules()` (already works under Bun, probed on Windows).
- [ ] **Step 4:** Rerun. Expected: PASS. Manual (document the result in the PR): `bun cli/cli.js --tray --skip-update -p 20142` on Windows, then confirm the Windows tray icon shows and Quit stops the server. On macOS and Linux the `systray2` icon check belongs to Plan 5's CLI matrix (not probed here).
- [ ] **Step 5: Commit.** `feat(cli): Bun-installed systray runtime and takeover of a server started by the old 9router CLI`

### Task 12: CLI tests on `bun test`, and the Windows update check

**Files:**
- Modify: `cli/test/serverProc.test.js`; Test: the whole `cli/test` suite

- [ ] **Step 1:** Replace `require("node:test")` with `require("bun:test")` in `cli/test/serverProc.test.js` and keep the `assert` calls as they are (all 7 cases keep their names and assertions). Delete the `custom-server`-style `node --test` script entry (done in Task 9).
- [ ] **Step 2:** Run `cd cli && bun test`. Expected: PASS: the 7 `serverProc` cases plus the cases added in Tasks 9–11 (about 30). Update `tests/__baseline__/test-counts.json` only for root-suite files; the `cli/` suite is gated by CI exit status.
- [ ] **Step 3: Windows update-while-running check** (manual, on this Windows box; record in the PR): reproduce the probe with a scratch `BUN_INSTALL`. Build two tarballs of the real CLI package with `cd cli && bun run build && bun pm pack --destination <dir>` at versions N and N+1 (`bun pm version patch` in a throw-away copy), then:
  1. `$env:BUN_INSTALL = "<scratch>"`; `bun add -g <dir>\literouter-N.tgz`.
  2. `& "<scratch>\bin\literouter.exe" --no-browser --skip-update -p 20143` in the background; wait until `curl localhost:20143/api/health` answers.
  3. `bun add -g <dir>\literouter-N+1.tgz`.
  Expected: exit code 0, no `EBUSY`/`EPERM` in the output, and `<scratch>\install\global\node_modules\literouter\package.json` shows N+1 while the server (whose cwd is `...\literouter\app`) is still answering. Record that the probe on 2026-11-23 with a JS-only package already passed this way, so the cause of the old `EBUSY` (native `.node` files) is gone; if this run does hit `EBUSY`, stop and report, since the CLI package must then not keep the server's cwd inside the install dir. Plan 5's CLI matrix repeats this on macOS and Linux.
- [ ] **Step 4: Commit.** `test(cli): move cli tests to bun test`

### Task 13: CI workflows and the staging image

**Files:**
- Modify: `.github/workflows/test.yml`, `.github/workflows/docker-publish.yml`, `.github/workflows/production-image.yml`
- Create: `.github/workflows/staging.yml`
- Test: `tests/unit/workflows.test.js`

**Interfaces:**
- `test.yml` (Plan 1 already moved it to `oven-sh/setup-bun@v2` with `bun-version: 1.4.4`). `on:` becomes `pull_request`, `push: branches: [main]` and `workflow_call` (the `staging` branch is covered by `staging.yml` calling it, so a push to `staging` does not run the suite twice; PRs into `staging` run it through `pull_request`). Job `unit` keeps Plan 1's steps and **replaces** `bunx eslint .` with `bun --bun run eslint .` (plain `bunx` obeys the `node` shebang), and replaces the Next build and standalone-size budget with: `bun test` in `cli/` (the CLI suite was never in CI before), `bun run build`, `git diff --exit-code -- src/shared/constants/providerIconManifest.js`, `bun scripts/smoke-server.mjs --spawn dist/app`, and `test "$(du -sm dist/app | cut -f1)" -le 30` (ceiling from Task 4). New job `image` (`needs: unit`, matrix `platform: [linux/amd64, linux/arm64]`, `permissions: contents: read`): `docker/setup-qemu-action@v3` (arm64 only), `docker/setup-buildx-action@v3`, `docker buildx build --platform ${{ matrix.platform }} --load -t literouter:ci .`, `bun scripts/check-image-size.mjs literouter:ci --max-mb 150`, `bun scripts/smoke-image.mjs literouter:ci --platform ${{ matrix.platform }}`. The two `docker buildx` setups use `cache-from/to type=gha` scoped by platform.
- `docker-publish.yml` (tags `v*`, `workflow_dispatch`): unchanged triggers, tags, `platforms: linux/amd64,linux/arm64`, `provenance: false`, `sbom: false`. It builds the new Dockerfile with no edit; no size step is added because the `image` job already gates the commit being tagged.
- `production-image.yml` (push to `main`): unchanged `if: github.ref == 'refs/heads/main'`, concurrency group, `${{ env.IMAGE }}:production-${{ github.sha }}`, `platforms: linux/amd64`, GHA cache. Only the Dockerfile underneath changes.
- `staging.yml` (new): `on: push: branches: [staging]`; `concurrency: { group: staging-image, cancel-in-progress: true }`; jobs `test` (`uses: ./.github/workflows/test.yml`) and `image` (`needs: test`, `if: github.ref == 'refs/heads/staging'`, `permissions: { contents: read, packages: write }`) that logs in to GHCR and runs `docker/build-push-action@v6` with `context: .`, `push: true`, `tags: ghcr.io/${{ github.repository }}-staging:staging-${{ github.sha }}`, `platforms: linux/amd64,linux/arm64`, `provenance: false`, `sbom: false`. No `latest`, no `production-*`, no `workflow_dispatch`.
- Branch protection on `staging` already matches `main` (Plan 1, Task 0); add `image (linux/amd64)` and `image (linux/arm64)` to the required checks of both branches after the first green run (`gh api` is an owner-visible settings change: ask first).

- [ ] **Step 1: Write the failing tests** (`workflows.test.js`, string/regex checks over the YAML text; no YAML dependency):
  - `"no workflow uses setup-node, npm or npx"`.
  - `"every workflow that installs Bun pins 1.4.4"`.
  - `"production-image only runs on main and tags production-<sha>"`: `branches: [main]`, `if: github.ref == 'refs/heads/main'`, `-production:production-${{ github.sha }}`, no `staging`.
  - `"docker-publish only runs on v* tags"` (and keeps `linux/amd64,linux/arm64`).
  - `"staging pushes only to the -staging repository with staging-<sha> tags"`: contains `-staging:staging-${{ github.sha }}`, contains neither `latest` nor `production`, triggers only `branches: [staging]`.
  - `"test.yml gates image size and the arm64 image"`: contains `check-image-size.mjs` and `linux/arm64`, `git diff --exit-code`, `cli` `bun test`.
  - `"deploy scripts cannot accept a staging tag"`: `scripts/deploy.sh` and `scripts/post-deploy.sh` both contain `literouter-production` and the `production-[0-9a-f]{40}` regex and not `staging`.
- [ ] **Step 2:** Run `cd tests && bun test unit/workflows.test.js unit/bun-version-pin.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the four workflow files. Keep `docker-publish.yml` and `production-image.yml` byte-identical except for what the tests require.
- [ ] **Step 4:** Rerun both. Expected: PASS (`bun-version-pin` now covers the Dockerfile and all workflows). Open the PR to `staging`; CI must be green: `unit`, both `image` legs. In the PR, quote the `size_mb` lines of both legs (each ≤ 150).
- [ ] **Step 5: Commit.** `ci: Bun build, image size gate, arm64 smoke and a staging-only image workflow`

### Task 14: Remove Next, Node-era dependencies and files; update docs

**Files:**
- Modify: `package.json`, `CLAUDE.md`, `AGENTS.md`, `README.md`, `DOCKER.md`, `CHANGELOG.md`, `.gitignore`, `.env.example` (only lines Plans 2–3 left that mention Next), `scripts/*` shebangs and `node ` usage
- Delete: `package-lock.json`, `next.config.mjs`, `postcss.config.mjs`, `tests/unit/open-package-external.test.js` (already replaced in Task 2), any remaining `custom-server.js`, `src/proxy.js`, `src/instrumentation.js` (Plan 2 should have removed them; delete if present)
- Test: `tests/unit/no-node-anywhere.test.js`

**Interfaces:** `package.json` ends with no `next`, `@next/third-parties`, `eslint-config-next`, `@tailwindcss/postcss`, `postcss`, `better-sqlite3`, `sql.js`, `@next/swc-linux-x64-musl`, `lightningcss-linux-x64-musl`, `@tailwindcss/oxide-linux-x64-musl`, the `comment_better_sqlite3` key, `undici`, `open`, `bcryptjs`, `uuid` (Plans 1–2 own the last four; this task asserts it). `optionalDependencies` is removed entirely if empty. The musl packages are removed because `bun install` selects the platform package from the lockfile (the Docker build stage runs on musl and in Task 7 proves `bun-plugin-tailwind` still bundles; if that build fails with a missing `@tailwindcss/oxide-linux-*-musl`, restore only that one as an `optionalDependency` and say so in the PR). `devDependencies` gains `@eslint/js`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `globals` (Task 8) and keeps `eslint`, `tailwindcss`, plus what Plan 3 added (`bun-plugin-tailwind`).

- [ ] **Step 1: Write the failing test** (`no-node-anywhere.test.js`): `"package.json has none of the removed packages"` (list above, over `dependencies`, `optionalDependencies`, `devDependencies`), `"no package-lock.json exists and bun.lock does"`, `"next.config.mjs and postcss.config.mjs are gone"`, `"no source file imports next, undici, sql.js, better-sqlite3, bcryptjs, uuid or open"` (scan `src`, `open-sse`, `cli`, `scripts`; allow `bun:sqlite`), `"no node invocation in CI, Docker, scripts or the CLI"`: scan `.github`, `scripts`, `Dockerfile`, `cli` (excluding `cli/test` and `*.md`) with the `NODE_GATE` regex from Global Constraints, and for `#!/usr/bin/env node`; expect zero matches (no allow-list).
- [ ] **Step 2:** Run `cd tests && bun test unit/no-node-anywhere.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `bun remove next @next/third-parties eslint-config-next @tailwindcss/postcss postcss better-sqlite3 sql.js @next/swc-linux-x64-musl lightningcss-linux-x64-musl @tailwindcss/oxide-linux-x64-musl` (plus any of `undici open bcryptjs uuid` still present), `git rm package-lock.json next.config.mjs postcss.config.mjs`, `bun install` to regenerate `bun.lock`, and `bun install --frozen-lockfile` to prove it is consistent.
  - Scripts: change every `#!/usr/bin/env node` in `scripts/` to `bun`, `node scripts/...` usage text to `bun scripts/...` (`translate-readme.js`, `injectDisplayToRegistry.mjs`, `bench/*.mjs`, `dev/seed-preview.mjs`); `scripts/bench/mock-suite.mjs` starts the gateway with `bun dist/app/index.js` (cwd `dist/app`) instead of `node custom-server.js`, drops `NEXT_TELEMETRY_DISABLED`, and its report line prints `Bun.version` instead of `process.version`.
  - `.gitignore`: add `/dist/`, `cli/app/`; remove `/.next/`, `/.next-cli-build/`, `.next-analyze/*`, `next-env.d.ts`.
  - Docs: **CLAUDE.md** (Commands: `bun install`, `bun run dev` = `bun --hot src/server/index.js` which now sees real peer IPs so the "every request is remote under `next dev`" paragraph is deleted, `bun run build`, `bun run compile`, `bun run start`, `cd tests && bun test --parallel`, `bun --bun run eslint .`, `bun run cli:pack`; Architecture: persistence is `bun:sqlite` only, remove the adapter fallback chain and the `custom-server.js` convention bullet, describe `src/server/` and `src/web/`; Tests section already moved by Plan 1). **AGENTS.md** (the `npm install` / `npm run dev` / `npx vitest` block). **README.md** (quick start unchanged; replace "LiteRouter vs 9Router" note `npm install -g 9router installs upstream` with `bun add -g literouter` instructions and the sentence "Staging images are published as `ghcr.io/raufimusaddiq/literouter-staging:staging-<sha>` for side-by-side checks and are never deployable to production"; update the Measured baseline table's Image-size row only in Plan 5 after the measurement). **DOCKER.md** (TLS section: `src/server/ca.js` replaces `custom-server.js`, the OS bundle is authoritative for `fetch` and `node:tls`; build section uses `docker build -t literouter .`; image is Alpine plus one executable, ≤ 150 MB; `docker exec -e BUN_BE_BUN=1 <c> /app/literouter -e "..."` for ad-hoc checks). **cli/README.md** (install `bun add -g literouter`, run `bunx literouter`, upgrade `bun add -g literouter@latest`, old users run `npm rm -g 9router` first, requires Bun ≥ 1.4.4). **CHANGELOG.md** (new `v0.5.82` bullets: Bun runtime and compiled image, Next removed with the dropped lint rules (`@next/*`, `jsx-a11y`, `import`), CLI renamed, update check on by default, staging image workflow, `NODE_OPTIONS` ceiling replaced by `mem_limit`).
- [ ] **Step 4:** Rerun the test. Expected: PASS. Then run the gates: `bun install --frozen-lockfile && cd tests && bun test --parallel` (Expected: exit 0 on Linux CI; on Windows `bun tests/__baseline__/verify-no-regression.mjs ../test-results.xml` reports no regressions and `verify-test-counts.mjs` passes), `bun --bun run eslint .` (0 errors), `bun run build`, the `NODE_GATE` command (Expected: no output; reword the `npm tarball` comments in `cli/hooks/trayRuntime.js` and `scripts/bench/*` comments that say `node`), `rg -n "from ['\"]next|next/" src open-sse` (no output), `git ls-files | rg "^package-lock.json|next.config|postcss.config"` (no output).
- [ ] **Step 5: Commit.** `chore: remove Next.js, native sqlite drivers and package-lock; Bun-only scripts and docs`

### Task 15: Release preparation (no outward action)

**Owner of execution: Plan 5 (cutover), only with the owner's explicit go-ahead.** This task changes no registry state.

**Files:** none besides the PR description.

- [ ] **Step 1:** Dry-run the package: `cd cli && bun run build && bun publish --dry-run`. Expected: lists `cli.js`, `src/`, `hooks/`, `app/`, `README.md`, `LICENSE`, version as in `cli/package.json`, no `.env`, no source maps, and size a few MB (record it; the tarball must not contain `node_modules`). Then `bun pm pack --destination <tmp>` and `bun add -g <tmp>/literouter-*.tgz` in a scratch `BUN_INSTALL`; `literouter --version` prints the version.
- [ ] **Step 2:** Put these release steps, verbatim, in the PR description under "Plan 5 cutover, needs owner go-ahead":
  1. `cd cli && bun run build && bun publish` (publishes `literouter`; needs the owner's npm login or token).
  2. After 1 succeeds, with a **final `9router` release** only if the owner wants one, run `npm deprecate 9router "9router moved to literouter. Run: npm rm -g 9router && bun add -g literouter (requires Bun >= 1.4.4, https://bun.sh)"`. `npm deprecate` has no Bun equivalent; the owner runs it by hand on their own machine.
  3. Verify: `bun add -g literouter@latest` on Windows, macOS and Linux, then the CLI matrix, including "old CLI server running → new CLI start" with a real `npm i -g 9router` install on Node (the unit tests in Task 11 use fakes; this is the real check).
- [ ] **Step 3:** Confirm `rg -n "bun publish|npm publish|npm deprecate" .github scripts cli/package.json` shows only `cli/package.json`'s `publish:cli` script (manual) and nothing in any workflow.
- [ ] **Step 4: Commit** nothing, or `docs: release steps for literouter (cutover)` if the CHANGELOG needed an edit.

---

## Done when

- `bun run build` writes `dist/app`; `bun scripts/build.mjs --compile bun-linux-x64-musl` and `... bun-linux-arm64-musl` write `dist/bin/literouter-<target>`.
- CI is green on a PR to `staging`: `unit` (tests, count and regression gates, eslint, cli tests, build, bundle smoke) and both `image` legs (`size_mb ≤ 150`, smoke passes, server runs as `literouter`).
- A push to `staging` publishes only `ghcr.io/<repo>-staging:staging-<sha>`; `deploy.sh` refuses it (tested).
- The `NODE_GATE` command prints nothing; no `next`, `better-sqlite3`, `sql.js` in `package.json`; `package-lock.json`, `next.config.mjs`, `postcss.config.mjs` are gone.
- `literouter` CLI: `bun add -g literouter` package builds and dry-runs, the launcher starts `dist/app` with Bun, the old-CLI takeover tests pass, and the Windows update-while-running check shows no `EBUSY`.
- Nothing was published or deprecated.

## Self-review notes (spec coverage)

- §6.6 build: Tasks 1, 4, 5, 7. Runtime-file inventory table covers every `fs`/`import.meta.url`/`process.cwd()` reader found. `copy-standalone-assets.mjs` removed (Task 4); `gen-provider-icon-manifest.mjs` kept and adapted (Task 4). `open`: replaced (Task 2).
- §6.6 Docker, compose, CA: Tasks 3, 7. `captain-definition`, `start.sh`, `docker-compose.yml`, `deploy.sh`, `post-deploy.sh` audited with a test; only `compose.production.yml` needed changes.
- §6.7 / §9.2 / §9.8 CLI: Tasks 9–12, 15. §9.5 arm64: Tasks 5, 7, 13. §9.7 staging: Task 13. §6.8 ESLint, CI: Tasks 8, 13. Next/Node removal and docs: Task 14.
- Items the spec lists that this plan could only verify partly: macOS/Linux `systray2` rendering and a real old-Node-CLI takeover (Plan 5 CLI matrix); arm64 executable run (CI under QEMU).
