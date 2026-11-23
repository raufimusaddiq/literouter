# ADR-0055: Bun packaging: bundle, compiled executable, Docker image, CLI and CA trust

- Status: Accepted
- Date: 2026-11-23
- Origin: Plan 4 (packaging) tasks 1 to 14

## Context

Plans 1 to 3 moved the server and the dashboard onto Bun. Plan 4 changes how the product is built, shipped and launched: a Bun bundle, a single compiled musl executable, an Alpine image, a Bun-only CLI, and no Next.js, Node or npm anywhere. Many choices below are forced by Bun behaviour that is not visible from the code.

## Decisions

### D1. No cwd guard for the bundle

A `Bun.build` bundle with no HTML imports resolves `join(import.meta.dir, ...)` assets from any working directory (probed), so the planned `assertBundleCwd` was dropped and the contract changed with it. `tests/server/bundle-cwd.test.js` asserts a run from the bundle's own directory and from another one.

**Where:** `src/server/paths.js`; `scripts/build.mjs`

### D2. Bundled and compiled runs locate assets next to themselves

`paths.js` exports `isCompiled` (`import.meta.dir` contains `$bunfs` or `~BUN`) and `isBundled` (the `LITEROUTER_BUNDLED=1` define). In either mode `PUBLIC_DIR` is `import.meta.dir/public` and `SPA_DIR` is `import.meta.dir/web`; environment overrides still win. A bundled or compiled run counts as production in `spaBuild.js`, so it never starts the dev build or `fs.watch`; the CLI also sets `NODE_ENV=production` for the server child unless the caller set it.

**Where:** `src/server/paths.js`; `src/server/spaBuild.js`; `cli/src`

### D3. The SPA builder is loaded through a runtime-built specifier

`spaBuild.js` imports `src/web/build.js` with a specifier assembled at run time (`["..", "web", "build.js"].join("/")`). `Bun.build` follows literal and constant-folded `import()` specifiers, which would pull `bun-plugin-tailwind`, Tailwind and the native oxide and lightningcss `.node` binaries into the server bundle (2.27 MB down to 1.47 MB without them, and no `.node` file). Version readers use `import { version } from "package.json" with { type: "json" }` so Bun tree-shakes the manifest instead of inlining all of it.

**Where:** `src/server/spaBuild.js`; `scripts/build.mjs`

### D4. Compile assets, embedded roots and dotenv

An asset path inside the build `root` is embedded at its root-relative path; one outside `root` is embedded under its basename. `compileApp` builds the SPA into `dist/compile-stage/web`, removes it after a successful compile, and passes absolute `[<root>/public, <stage>/web]` so they land at `/$bunfs/root/public` and `/$bunfs/root/web`. In a compiled executable `stat` and `Bun.file` work on `/$bunfs/root/...` but `realpath` throws ENOENT, so `static.js` skips realpath containment only for a real embedded root (`isCompiled` and a path anchored at `^/\$bunfs/` or `^<drive>:[\\/]~BUN[\\/]`); the lexical traversal checks still apply, and an on-disk directory named `~BUN` or `$bunfs` keeps realpath containment. Compiled executables autoload `.env` and `bunfig.toml` from the cwd by default, so compile sets `autoloadDotenv: false` and `autoloadBunfig: false`. `Bun.build` throws `AggregateError("Bundle failed")` unless `throw: false`, so `build.mjs` passes `throw: false` and prints every log.

**Where:** `scripts/build.mjs`; `src/server/static.js`

### D5. Subprocesses use the executable as `bun`

`bunCommand()` returns `{ command: process.execPath, env: { BUN_BE_BUN: "1" } }`. In a compiled executable `process.execPath` is the app itself, and it behaves as the `bun` CLI only when `BUN_BE_BUN=1` is set. The devin MCP launcher, the pxpipe `bun add`, the compose healthcheck and `docker exec` checks all use it. The smoke script deletes `BUN_BE_BUN` from the child environment when it starts the executable as a server. pxpipe spawns with file-descriptor stdout and stderr so `install.log` keeps appending; `findNpm` keeps its name, export and `NPM_NOT_FOUND` code. The `open` package was already replaced in Plan 2 by `src/shared/utils/openBrowser.js` (rundll32 on Windows, launch failures propagate), and `tests/unit/open-package-external.test.js` stays as its guard.

**Where:** `src/lib/runtimeBun.js`; `src/shared/utils/openBrowser.js`; `scripts/smoke-image.mjs`

### D6. System CA store reaches `fetch` and `node:tls`

`useSystemCaStore` sets the `node:tls` defaults and also wraps `fetch`, adding `tls.ca = system` unless the caller passed a non-empty `tls.ca`. An empty `ca: []` is treated as unset by Bun (it falls back to bundled roots), so empty counts as not supplied, and the `ca` key goes after the `tls` spread. An empty OS store fails closed. The wrap is idempotent through a symbol-stored original. `open-sse/utils/proxyFetch.js` captures the native `fetch` at load and patches `globalThis.fetch` itself, so the CA list is shared through `Symbol.for("literouter.systemCaList")` and applied on every call; import order no longer matters. `open-sse` must not import `src/`, hence the symbol.

**Where:** `src/server/ca.js`; `open-sse/utils/proxyFetch.js`

### D7. Docker: builder on the build platform, one executable in Alpine

The builder stage runs on `$BUILDPLATFORM` and cross-compiles the musl target (`bun scripts/build.mjs --compile <target> --outfile /out/literouter`), so arm64 needs QEMU only for the runner stage's `RUN apk`, which `staging.yml` and the arm64 leg of `test.yml` set up. The user `literouter` has uid and gid 1000, the old `node` user's ids, so existing `/app/data` volumes keep correct ownership. Busybox `ps` truncates user names, so `smoke-image.mjs` asserts `Uid: 1000` from `/proc/<pid>/status`. `TZ` works without tzdata. Measured: amd64 image 116.3 MB (limit 150), executable 112.0 MB for x64 and 110.9 MB for arm64, `dist/app` 10 MB.

**Where:** `Dockerfile`; `scripts/check-image-size.mjs`; `scripts/smoke-image.mjs`; `tests/unit/docker-files.test.js`

### D8. Native musl packages are not pinned

`@tailwindcss/oxide-linux-x64-musl` and `lightningcss-linux-x64-musl` were removed from `optionalDependencies`. The musl image build still bundles the SPA without them (image smoke: health, dashboard and chat all 200). The builder runs on the build platform, so only the amd64 binaries could ever be needed in CI, and the arm64 musl variants are not.

**Where:** `package.json`; `bun.lock`

### D9. Memory ceiling: `mem_limit`, not `NODE_OPTIONS`

V8's `--max-old-space-size` does not apply on Bun (JavaScriptCore). `compose.production.yml` caps memory with `mem_limit`, and `BUN_OPTIONS=--smol` is the opt-in knob for a smaller heap.

**Where:** `compose.production.yml`; `DOCKER.md`

### D10. Staging and production images are separate

Staging publishes only `ghcr.io/<repo>-staging:staging-<sha>`; `deploy.sh` and the related scripts accept only `-production:production-<40 hex>`, and a test covers the refusal. `test.yml` runs on pull requests, on pushes to `main` and through `workflow_call` from `staging.yml`. The concurrency groups differ (`test-<ref>` and `staging-image`), so the caller cannot deadlock on the callee.

**Where:** `.github/workflows/staging.yml`; `.github/workflows/test.yml`; `scripts/deploy.sh`

### D11. The CLI has no `postinstall`

`bun add -g` blocks lifecycle scripts, so `ensureRuntime` installs `systray2@2.1.4` lazily, on macOS and Linux only (the Windows tray is a PowerShell NotifyIcon). It runs just before `claimPort`, so `--help` and `stop` never spawn `bun add`. The server child runs with cwd `cli/app`, `--dns-result-order=ipv4first`, no `--max-old-space-size`, and `NODE_ENV=production`. `cli/bun.lock` is committed so CI installs with `--frozen-lockfile`.

**Where:** `cli/src`; `cli/hooks`; `cli/package.json`

### D12. Stopping and taking over from the launcher

The pidfile gains `launcherPid`; old readers ignore it. The launcher must die before its server, or it respawns it. Ownership is proven by the server's parent pid (the bin may be a symlink, so command-line matching is only a fallback). On Windows the launcher is killed without `/T`, because that would take the detached server too, and the tray helper is found by its `tray.ps1` command line. A pidfile with `launcherPid` was written by the new CLI, so the legacy takeover check (a PowerShell CIM query) is skipped. If an old Node launcher respawns its server after the kill, the new CLI exits 1 with guidance instead of moving to another port. That message cannot quote `npm rm -g 9router` because of the Node gate; it tells the user to remove the old package with the package manager that installed it. The pidfile directory is `DATA_DIR`, else `~/.9router`, but `%APPDATA%\9router` on Windows (unchanged).

**Where:** `cli/src`; `cli/test`

### D13. No Node anywhere, enforced by a gate

`.github`, `scripts`, `Dockerfile` and `cli` (excluding `cli/test` and `*.md`) contain no `node`, `npm` or `npx` invocation and no `#!/usr/bin/env node` shebang, matched by one regex that `tests/unit/no-node-anywhere.test.js` runs with no allow-list. Variables that happened to be called `node` were renamed. The cli test for a Bun shebang tolerates a trailing `\r` on a Windows CRLF checkout.

**Where:** `tests/unit/no-node-anywhere.test.js`; `cli/test/package.test.js`

### D14. Lint ignores no longer mention Next

`eslint.config.mjs` dropped the `.next/**` and `next-env.d.ts` ignores that ADR 0054 D6 kept until this plan removed `.next` everywhere. `tests/unit/eslint-config.test.js` asserts there are no `@next/*` rules, the six React Compiler rules and `exhaustive-deps` stay warnings, `react/jsx-key`, `react/no-unescaped-entities` and `react/jsx-no-undef` are errors, and `package.json` has no `eslint-config-next`. `jsx-a11y` and `import` stay.

**Where:** `eslint.config.mjs`; `tests/unit/eslint-config.test.js`

## Consequences

- Putting a literal `import("../web/build.js")` back into `spaBuild.js` makes the server bundle carry Tailwind and native `.node` files again.
- Dropping `autoloadDotenv: false` makes a compiled executable read a stray `.env` from whatever directory it is started in.
- A subprocess that spawns `process.execPath` without `BUN_BE_BUN=1` starts a second server instead of a `bun` CLI.
- If a future Tailwind or lightningcss release stops resolving its musl binary on Alpine, restore only that package as an `optionalDependency`; the image smoke fails first.
- Changing the uid of `literouter` leaves existing `/app/data` volumes unreadable.
