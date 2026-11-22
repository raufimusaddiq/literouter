# ADR-0031: CLI launcher: process ownership, tray and API auth

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

The `cli/` package launches the gateway server, manages a tray process and offers admin subcommands against a running gateway. It must be safe on machines where it did not start every listener, where PIDs get recycled after reboots, and where macOS places specific constraints on tray processes. It also needs a way to authenticate to the server's API without a password.

## Decisions

### D1. Only kill a server we own, verified by the listener on the recorded port

On restart the launcher kills only the server it spawned itself, recorded in a pidfile, then picks a free port; it never force-kills a foreign listener. The pidfile record includes the port, and a PID is "ours" only if it is the process listening on that recorded port. After a reboot or crash the PID may belong to an unrelated process, so a stale record is dropped rather than acted on. A hide-to-tray child is handed its predecessor's PID through the environment so it reclaims the port instead of treating its predecessor as a foreign listener. The pidfile is the whole ownership record; coexisting instances would need per-port pidfiles.

**Where:** `cli/cli.js`: restart and port selection; `cli/src/cli/utils/serverProc.js`

### D2. Port matching on Windows is exact

`netstat -ano` parsing counts only LISTENING rows and compares the port from the local-address column exactly, so 2012 never matches 20128.

**Where:** `cli/src/cli/utils/serverProc.js`: netstat parser

### D3. CLI API calls authenticate with a file-based shared secret

The CLI reads the raw machineId written by the server to a shared file, which guarantees the token matches, and a random secret shared via file makes the token unpredictable from machineId alone. The CLI bypasses dashboard auth with the `x-9r-cli-token` header, which is what allows resetting authMode to "password" when OIDC is misconfigured and the user is locked out.

**Where:** `cli/src/cli/api/client.js`; `cli/src/cli/menus/settings.js`

### D4. Subcommands skip the launcher flow

Subcommands (e.g. `9router xai video ...`) run against an already-running gateway and bypass the launcher: no runtime self-heal and no server spawn.

**Where:** `cli/cli.js`

### D5. Tray and detach behavior

A detached process has no TTY, so auto-relaunch after update falls back to tray mode (tray-only: no TUI). SIGHUP is ignored so closing a macOS terminal does not kill the background tray process. On macOS the current process stays alive: spawning a detached child puts it outside the login session and NSStatusItem silently fails. Args for a detached tray child are shared by the hide-to-tray respawn and the OS autostart entries so the bound host and port survive both.

**Where:** `cli/cli.js`; `cli/src/cli/utils/serverProc.js`: detached tray args helper

### D6. Update checking is off by default

This fork has no published package of its own and the upstream "9router" package is a different product, so the update check is off unless `NINEROUTER_UPDATE_PACKAGE` names the package to track.

**Where:** `cli/cli.js`: update channel check

## Consequences

- Killing by port alone or trusting a bare PID can terminate an unrelated process after PID recycling.
- Substring port matching in netstat output hits the wrong listener.
- A guessable CLI token (machineId only) weakens the auth bypass.
- Detaching the tray on macOS makes the status item fail silently.
- Enabling update checks against the upstream package would pull in a different product.
