# ADR-0032: CLI launcher runtime deps, tray and build

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

The `cli/` package (published as `9router`) bundles the Next standalone server and launches it with a tray icon and optional autostart. Native or antivirus-sensitive pieces (better-sqlite3, systray2) are not shipped inside the tarball; they are installed into a user-writable runtime directory (`~/.9router/runtime`). Windows file locks, macOS launchd semantics and AV false positives drive most of these decisions.

## Decisions

### D1. Native runtime deps live in USER_DATA_DIR/runtime, not in the bundle

better-sqlite3 (and systray2 on macOS/Linux) are installed into `~/.9router/runtime/node_modules`, which is user-writable and avoids Windows EBUSY locks during `npm i -g` updates. The build strips better-sqlite3 from the bundled `node_modules` and keeps pure-JS `sql.js` as a fallback (node:sqlite on Node >= 22.5 and bun:sqlite are built in). `NODE_PATH` is injected with both runtime and bundled `node_modules` so child Node processes resolve sql.js (bundled) and better-sqlite3 (runtime).

**Where:** `cli/hooks/sqliteRuntime.js`; `cli/scripts/build-cli.js`: step 3b

### D2. One combined background install that never blocks start and backs off on failure

`cli.js` self-heals runtime deps (sql.js, better-sqlite3, systray2) with ONE background `npm install`. It never blocks server start (the server falls back to bundled sql.js meanwhile), and a failed install leaves a marker so offline launches back off instead of retrying and hanging every time. All deps go in a single install and are written to the runtime `package.json`, so a later install of one cannot prune another; native packages are saved as `optionalDependencies` so a failed native build does not fail sql.js. The install helper returns `{ skipped, ok, reason? }` and never throws. Postinstall warms the same runtime so the first `9router` start needs no network; its failure is non-fatal and `cli.js` retries with backoff.

**Where:** `cli/cli.js`; `cli/hooks/postinstall.js`; `cli/hooks/sqliteRuntime.js`: combined install

### D3. better-sqlite3 version is gated by Node major

Mirroring `src/lib/db/driver.js`: better-sqlite3 13.x is N-API and ships per-platform prebuilds inside the package, so it needs no ABI-specific download and requires Node >= 22 (the implicit `node-gyp rebuild` is skipped). Older runtimes stay on 12.6.2, which fetches an ABI-specific binary via prebuild-install. On Windows `npm.cmd` needs a shell, so one command string (static flags) is passed instead of an args array to avoid Node's DEP0190 warning.

**Where:** `cli/hooks/sqliteRuntime.js`

### D4. The tray uses systray2 on macOS/Linux and PowerShell NotifyIcon on Windows

Windows uses a PowerShell NotifyIcon, so no binary is needed, and the published tarball stays free of unsigned Go binaries that trigger AV false positives (for example Kaspersky flagging `tray_windows.exe`). On macOS/Linux the maintained `systray2` fork is lazily installed because the original `systray@1.0.5` bundles a 2017 x86_64 Go binary whose Mach-O headers modern dyld (macOS 14+, Apple Silicon) rejects, so the tray silently fails. The legacy package is removed from all known locations and is only a last-resort fallback that will not show an icon. systray2's tarball sometimes lands without the executable bit on macOS, so spawn fails with EACCES; a best-effort `chmod +x` runs at install and on every tray init. systray2 exposes `ready()` rather than onReady/onError, and failures are surfaced so users see why the icon did not appear.

**Where:** `cli/hooks/trayRuntime.js`; `cli/src/cli/tray/tray.js`

### D5. Tray lifecycle details on macOS

The bundled `icon.png` is a full-color RGBA logo and must not be marked as a template icon, or macOS renders a solid white square (template mode uses only alpha). Killing the tray waits for the Go binary to exit (returns a Promise), since hide-to-tray must release the NSStatusItem before a new tray is spawned or the new icon silently fails to register. Shutdown is graceful: send `{type:"exit"}` over IPC so the binary calls `systray.Quit()`; SIGKILL leaves a ghost icon until logout and duplicates after respawn.

**Where:** `cli/src/cli/tray/tray.js`

### D6. macOS autostart: launchd agent runs node directly and never kills itself

The plist invokes node plus `cli.js` by absolute path with no shell wrapper; the old `zsh -l -c` design depended on nvm/.zshrc sourcing and PATH, which varies by user. `EnvironmentVariables.PATH` explicitly includes node's bin dir so children (runtime `npm install`) resolve. Enabling registers with launchd in the current session (otherwise it takes effect only at next login) after an `unload` that defends against replacing an existing plist. `launchctl unload/load` sends SIGTERM to the running process, so when the current process is the agent's own running instance (detected by a helper), enable and disable skip launchctl: otherwise clicking "Disable Auto-start" kills the process and the tray icon disappears instead of the label flipping. The plist is updated on disk and launchd picks it up at next login. `isAutoStartEnabled` requires both the plist and the launchd registration, or the menu would show "Enabled" for a failed agent.

**Where:** `cli/src/cli/tray/autostart.js`: `isAutoStartEnabled`, enable/disable paths, running-agent check

### D7. Windows and Linux autostart invocation

Windows autostart runs node plus `cli.js` directly with a hidden window, avoiding the fragile `9router.cmd` lookup that depended on the npm prefix. Linux Desktop Entry `Exec` values double-quote every path/value so spaces in the install path do not split the command line.

**Where:** `cli/src/cli/tray/autostart.js`

### D8. Build must include dependencies that tracing can drop

Next 16 nests standalone output under the project name when `NEXT_TRACING_ROOT_MODE=workspace` (for example `standalone/9router/server.js`), so the build locates the server accordingly. `open` is an external (`serverExternalPackages` in `next.config.mjs`) and must exist in the bundle's `node_modules` or every importer throws MODULE_NOT_FOUND; output tracing normally copies it, and the build re-checks it as it does for sql.js. The complete generated server tree is merged in step 6b because trace-pruned standalone output can omit dynamically loaded route modules or chunks.

**Where:** `cli/scripts/build-cli.js`

### D9. TUI input keeps raw mode on for the whole session

stdin is primed once globally because toggling raw mode between menus adds latency on macOS. The interactive menu uses readline keypress plus a raw `data` fallback to prevent arrow-key escape sequences leaking on macOS.

**Where:** `cli/src/cli/utils/input.js`

## Consequences

- Bundling better-sqlite3 or a tray binary reintroduces Windows EBUSY on global updates and AV false positives.
- A blocking or retry-on-every-launch install hangs offline starts.
- Running launchctl unload from the managed process kills the CLI and the tray icon.
- Using the legacy systray or skipping the chmod gives an invisible tray on modern macOS.
- Skipping the `open`/server-tree merge steps yields MODULE_NOT_FOUND or missing routes at runtime in the published package.
