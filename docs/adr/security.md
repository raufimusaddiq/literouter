# Security

Rules that look like over-engineering until someone removes them. Each bullet: rule, why, `Where`.

## Client IP and local trust

- **Locality comes from the TCP socket, never from headers.** The peer address is read from the socket and stored per request as `{ peerIp, clientIp, isLocal }`; guard, limiters and handlers read it from the request context and must not re-derive it from `Host`, `X-Forwarded-For` or `X-Real-IP`. `x-forwarded-for` and the retired `x-9r-*` names are stripped before the guard. Access-granting headers must never be snapshotted into request details (the dashboard renders them). Where: `src/server/trust.js` `buildRequestContext`, `src/server/context.js`, `src/server/index.js` `STRIPPED_HEADERS`.
- **A loopback peer carrying a proxy marker is a proxy hop, not the operator.** Any of `x-forwarded-for`, `x-real-ip`, `forwarded`, `x-forwarded-proto`, `x-forwarded-host`, `via`, `cf-connecting-ip`, `true-client-ip` means remote (Cloudflare to Caddy to loopback stays remote). A bare nginx `proxy_pass` sends none, so `TRUST_LOOPBACK_AS_LOCAL=false` treats every loopback peer as a proxy. One marker list only. Where: `src/lib/auth/proxyMarkers.js`.
- **Forwarding headers count only from a loopback peer, and the rightmost XFF hop wins.** The leftmost entry is client-supplied and must never key a rate-limit or lockout bucket. Assumes exactly one trusted proxy hop. Where: `src/server/trust.js` `deriveClientIp`.
- **Parse hosts and addresses IPv6-aware.** Splitting on the first colon turned every IPv6 form into "" so `::ffff:127.0.0.1` was not loopback. Where: `src/server/trust.js` `isLoopbackAddress`.
- **Browser-on-host access needs loopback peer, no proxy marker, loopback `Origin` and auth.** The `Origin` check blocks CSRF from other origins that look local. Where: `src/server/guard.js` `isLocalRequest`.
- **Spawn and host-secret routes are local-only even with `requireLogin=false`.** Disabling login must not give a remote host a shell-adjacent surface. Extras GET stays open (remote dashboard renders the install log), mutating methods are local-only. `/api/auth/reset-password` never returns the default password. Where: `src/server/guard.js` `LOCAL_ONLY_PATHS`, `LOCAL_ONLY_MUTATING_PATHS`.
- **Client-side remote detection is only a UI hint.** Enforcement is the guard. Where: `isRemoteHost` in the endpoint page.

## Auth

- **Count the login attempt before the slow bcrypt compare.** Otherwise parallel guesses all read the pre-lockout count. Success deletes the entry. Where: `src/lib/auth/loginLimiter.js` `beginAttempt`.
- **No JWT for the default password (`123456`) on a remote client.** A valid session would let a remote attacker PATCH `/api/settings` to disable auth (CVE-2026-56679 class). A remote fresh install must set `INITIAL_PASSWORD` or change the password locally. Where: `src/app/api/auth/login/route.js`.
- **Valid API keys bypass the failed-auth IP throttle.** Behind Cloudflare without Caddy `trusted_proxies` many users share one edge IP; only failed validations count, and only they get the 429. Where: `src/lib/auth/apiKeyThrottle.js`.
- **`PATCH /api/settings` strips `PROTECTED_SETTING_KEYS`** (CWE-915 mass assignment); passwords change only via `newPassword`. Where: `src/app/api/settings/route.js`.
- **Public prefixes must list the root aliases** (`/v1`, `/v1beta`, `/codex`, `/responses`): the guard sees the requested path before the alias maps to `/api`. The guard reads settings from the DB, never via self-fetch (deadlock). Where: `src/server/guard.js` `PUBLIC_PREFIXES`.
- **Minimal profile hides by prefix; no retained feature may live under a hidden prefix** (the console-log API moved off `/api/translator` for this reason). Where: `src/server/guard.js` `MINIMAL_HIDDEN_PREFIXES`.
- **Secret compares are constant time.** `safeEqual` hashes both sides first (no length leak); API key lookup compares every row with sha256 + `timingSafeEqual`, no early exit. Where: `src/shared/utils/safeEqual.js`, `src/lib/db/repos/apiKeysRepo.js` `findRowByKey`.
- **Machine ID and the CLI secret are persisted to files** so CLI, server and guard agree; the CLI token adds a random 0600 secret so it stays unpredictable if the machine ID leaks. Where: `src/shared/utils/machineId.js`.

## API keys

- **Restricted keys match resolved `providerId/model` identities, exactly, once, up front.** No wildcards or deny mode. `cx/gpt-5`, `codex/gpt-5` and an alias are one target; a raw string that merely looks listed is not. Checked before bypass handling, combo expansion and credential lookup. An allowed combo grants its members, gated on the combo as a whole, not per member (else failover leaks). Where: `src/sse/services/keyAccess.js`.
- **Nested combos inherit the outer decision; only gateway-appended capacity adapters are dropped** unless the key may call them directly. Where: `filterAdapterModels`.
- **Read the key from Bearer, `x-api-key`, `x-goog-api-key` and `?key=`**, the same places as the guard; `extractApiKey()` reads only two and would make a restricted key look unrestricted. Where: `extractClientApiKey`.
- **Routes bypassing `handleChat` enforce access themselves**; model list/info filter by the allowed set and answer the same 404 as an unknown model. Where: `src/app/api/v1beta/models/**`, `src/app/api/v1/models/info/route.js`.
- **Access parsing fails closed.** `restricted` has its own INTEGER column so a corrupt allow list can only shrink access; missing field means unrestricted; over-limit lists get 400, not truncation; the 403 names only what the client sent. Where: `src/shared/utils/keyAccess.js` `keyAccessFromColumns`.
- **Usage stores a keyed HMAC fingerprint (`fp_` + 16 hex), never the client key** (issue #136). Keyed with `API_KEY_SECRET`; per-key usage responses are keyed by key id so neither key nor fingerprint reaches the browser. `apiKeys.key` stays plaintext (live credential). Legacy JSON import runs after migrations, so `migrate.js` reuses `rewriteUsageDay`. Where: `open-sse/utils/keyFingerprint.js`, `src/lib/db/migrations/003-fingerprint-usage-api-keys.js`, `src/lib/keyUsage.js`.
- **Generated keys are `sk-` + 24 random bytes base64url; no machine ID embedded.** Where: `src/shared/utils/apiKey.js`.

## SSRF and outbound URLs

- **Three layers for caller-supplied URLs** (issue #3714): literal host/IP check, DNS-resolved check (nip.io, A record 127.0.0.1), and `fetchPublic` that never auto-follows redirects and re-validates each hop (max 5). DNS failure is not an SSRF signal. Where: `src/shared/utils/ssrfGuard.js`.
- **Compare numeric addresses.** IPv6 is parsed to 8 groups so `::ffff:127.0.0.1` equals `::ffff:7f00:1`; IPv4-mapped, NAT64 (`64:ff9b::/96`) and IPv4-compatible embed an IPv4 that is checked; trailing-dot hostnames normalized. Where: `ssrfGuard.js`.
- **Every caller-controlled URL goes through one gate at the top of the handler** (`providers/validate`), because per-branch guarding missed sinks. The local operator reaches LAN nodes via per-hop `allowPrivate`, never by skipping the guard. Trim trailing slashes with a loop, not a regex (ReDoS). Where: `src/app/api/provider-nodes/**`, `src/app/api/providers/validate/route.js`.
- **Remote image fetch pins the validated IP.** Resolve once, require every record public, fetch `//<ip>/path` with `Host: <original>` and `tls.serverName` so a second lookup cannot rebind but the cert still verifies; reject userinfo URLs; `redirect: "manual"`; byte-capped stream read, then magic-byte check; `NO_PROXY` matches the pinned IP. Judge IPv4-mapped IPv6 by the embedded IPv4 (a `::ffff:0:0/96` rule would block everything under Node's BlockList). Only Bun `fetch` honors `tls`. Where: `open-sse/translator/concerns/image.js`.
- **A caller-supplied `proxy` option is never overridden by env/pool proxy.** Where: `open-sse/utils/proxyFetch.js`.
- **Remote media bounds:** `MAX_IMAGE_BYTES` 10 MB, `MAX_REMOTE_IMAGES_PER_REQUEST` 20 (400, not silent drop), `BLOCKED_HOSTS` loopback and metadata. Where: `open-sse/config/mediaConfig.js`.
- **Allowlist values interpolated into upstream URLs:** Kiro region via `AWS_REGION_PATTERN` (GHSA-6mwv-4mrm-5p3m); Trae uses a hardcoded origin allowlist and ignores the callback `loginHost`; Gemini `v1beta` model ids use the Gemini charset (path traversal); every registry provider id/alias is reserved as a provider-node prefix. Where: `src/lib/oauth/constants/oauth.js`, `src/lib/oauth/providers/trae.js`, `src/app/api/v1beta/models/[...path]/route.js`.
- **Never reflect upstream bodies to the client** (stack traces); Trae logs and returns a stable message, the Kiro api-key route returns no upstream body. Vertex sends API keys in `x-goog-api-key`, never the URL. Where: `open-sse/executors/trae.js`, `open-sse/executors/vertex.js`.
