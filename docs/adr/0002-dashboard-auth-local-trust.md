# ADR-0002: Dashboard auth, local-operator trust and minimal profile

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

LiteRouter serves both the public `/v1` LLM API (with its own API-key auth) and an operator dashboard with settings, provider credentials and routes that spawn processes or read host secrets. The guard in `src/server/guard.js`, run by `src/server/index.js` before every route and static file, is the single enforcement point deciding who may reach what, and the product ships a "minimal profile" that hides non-retained surfaces. It also runs behind tunnels and reverse proxies, so "local" must be proven, not assumed. These decisions explain how trust is established and where it deliberately is not.

## Decisions

### D1. Spawn and host-secret routes are local-only, even when requireLogin=false

Routes that spawn child processes (npm/pip installs, headroom start/stop/restart/proxy) or read host secrets are restricted to the local operator. They must stay unreachable to a remote caller even if `requireLogin=false`, because disabling login must not hand a remote host a shell-adjacent surface. The extras gate is method-aware: GET stays open because the remote dashboard renders installed extras and the install log tail, while mutating methods are local-only. The password reset route (`/api/auth/reset-password`) clears the stored hash back to the default, is enforced local-only by the guard, and never returns the default literal in its response.

**Where:** `src/server/guard.js`: `LOCAL_ONLY_PATHS`, `LOCAL_ONLY_MUTATING_PATHS`; `src/app/api/auth/reset-password/route.js`: `POST`; `tests/unit/dashboard-guard.test.js`

### D2. Browser-on-host access needs a loopback peer, no proxy marker, a loopback Origin and auth

A request counts as a local browser only when `src/server/trust.js` classified it local (the socket peer is loopback, no proxy marker is present, and any `Origin` is loopback; see ADR 0001) and the caller is authenticated (a JWT, or `requireLogin=false`). The socket peer is taken from the connection, never from `Host`, which the client controls. Requiring a loopback `Origin` blocks CSRF from other origins that would otherwise look local, and the proxy-marker rule blocks tunnel and Caddy traffic. Under Next a direct loopback request was never local; under Bun it is, so `bun --hot` in development reaches the localhost-only routes. CLI token requests are already treated as trusted local-machine calls, so the database settings route skips the password re-auth step for them.

**Where:** `src/server/guard.js`: `isLocalRequest` plus `isAuthenticated`; `src/server/trust.js`: `buildRequestContext`; `src/server/context.js`; `src/app/api/settings/database/route.js`: `isCliRequest`

### D3. Client-side remote detection is only a UI hint

`isRemoteHost` in the endpoint page and the token-saver page's handling of hidden headroom only adjust what the UI shows. They are never a security boundary; real enforcement is server-side in the guard. When the minimal profile hides `/api/headroom` (it answers 404), the token-saver client does not request it and shows "not available" instead of an error.

**Where:** `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js`: `isRemoteHost`; `src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js`: `refreshHeadroomStatus`

### D4. Secrets are never mass-assigned from a settings PATCH

`PATCH /api/settings` strips `PROTECTED_SETTING_KEYS` (the password) from the request body before applying it (CWE-915, mass assignment). A password change goes only through the explicit `newPassword` handling, which does the proper verification and hashing.

**Where:** `src/app/api/settings/route.js`: `PROTECTED_SETTING_KEYS`

### D5. Public prefixes must include the root-level aliases; the guard reads the DB directly

The guard runs on the path the client requested, before the route table maps an alias such as `/v1`, `/v1beta`, `/codex` or `/responses` to its `/api` handler (the table replaces Next's `rewrites()`). Each alias must therefore be listed in `PUBLIC_PREFIXES` explicitly; otherwise the guard demands dashboard auth for an endpoint that uses API keys. The guard also reads settings straight from the database rather than fetching its own API, because a self-fetch from inside the guard would deadlock.

**Where:** `src/server/guard.js`: `PUBLIC_PREFIXES`, `loadSettings`; `src/server/routes.js`

### D6. Minimal profile hides surfaces but keeps the routes built

With `MINIMAL_PROFILE=true` the guard hides non-retained product surfaces (PRD section 18) by prefix. The routes still exist in the build, so rollback is a config flip, not a redeploy. Before adding an entry, trace inbound references: a surface nothing retained imports should be deleted outright, not gated. A consequence is that no retained feature may live under a hidden prefix; the console-log API was moved off `/api/translator` because hiding the translator playground silently took the only in-browser server log stream down with it, and a boundary test now guards this.

**Where:** `src/server/guard.js`: `MINIMAL_HIDDEN_PREFIXES`; `tests/unit/minimal-profile-boundary.test.js`

### D7. Secret comparisons are constant-time

`safeEqual` hashes both sides first so the compare runs over equal-length buffers and leaks neither content nor length. The API key lookup compares every row (no early exit) using sha256 plus `timingSafeEqual`, so response time does not reveal which key prefix matched.

**Where:** `src/shared/utils/safeEqual.js`: `safeEqual`; `src/lib/db/repos/apiKeysRepo.js`: `findRowByKey`

### D8. Machine ID and CLI secret are persisted to files

The raw machine ID is persisted to a file so the CLI, the server and the guard always agree on the same value, even when `machineIdSync` fails or returns inconsistent results across runtimes. The CLI token additionally uses a random secret generated on first run and persisted (mode 0600), so the token stays unpredictable even if the machine ID leaks.

**Where:** `src/shared/utils/machineId.js`: `loadRawMachineId`, `loadCliSecret`

## Consequences

- Dropping the method-aware or local-only gating would expose process-spawning and host-secret routes to remote callers whenever login is disabled.
- Trusting loopback on Host alone (or on the socket alone) reopens tunnel and CSRF access to the local operator surface.
- Forgetting to list a root rewrite in the public prefixes makes API-key clients get dashboard auth errors; fetching settings via HTTP from the guard hangs it.
- Moving retained features under hidden prefixes silently breaks them in the minimal profile.
- Non-constant-time comparisons or per-runtime machine IDs weaken key checks and make CLI tokens diverge between processes.
