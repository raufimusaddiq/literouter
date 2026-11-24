# Unreleased
- **Providers**: new OpenDesign Go (`odg`) and DeepRelay (`dr`) gateways on the OpenAI, Anthropic and Responses lanes, with quota tracking (OpenDesign reads its separate control key from the connection's provider data, which API responses never return). Synthetic quota now shows the subscription, hourly search and weekly pool. Alibaba Token Plan gains its Anthropic endpoint and ten catalog ids.
- **Models**: Codex GPT 6.2 Sol and Astra; Kimi Code `k3.1-pro` and `k3.1-pro-highspeed` with the 1M window; Antigravity Gemini 4 Hydrogen in low/medium/high/xhigh tiers (bare Hydrogen and Carbon now default to high); Cloudflare System One Clef Omni and Clairic, plus current Workers AI chat models in place of the ones Cloudflare retired on 2026-11-20; NVIDIA-hosted Nemotron 3 Ultra advertises tools and 1M; native Mistral Large 4 advertises 1M; ten OpenCode free models with their published windows, and `/v1/models` reads OpenCode's live free catalog (cached 10 min).
- **Pricing**: every new model has a pricing and capability row (vendor-published rates; an explicit zero where the vendor publishes none). Cloudflare Clef Flash is corrected to $0.038 per million input tokens.
- **Kiro**: every call, token refresh included, identifies as Kiro IDE 1.4.154 (the old `kiro-ide/1.0.0` identity is now rejected), and a 429 `USER_REQUEST_RATE_EXCEEDED` replays the turn on the `/v1/responses` lane (`LITEROUTER_KIRO_CREATE_RESPONSE=auto|always|off`).
- **Antigravity**: identifies as Hub 2.33.0, leads generation requests with the official identity prompt, rewrites OpenClaw and Hermes prompt lines that drew a fake 429, sends `Accept: text/event-stream` on streams, and the dashboard lists each account's live model catalog.
- **System One**: Cloudflare answers are unwrapped from their `{ result }` envelope (usage is recorded again), the request body carries Cloudflare's short model selector, and Clairic requests are validated on `fields`.
- **Fixes**: Claude Code's per-turn billing header no longer splits the cached Claude system prompt; Mistral array content streams as text to Claude clients; Qoder image uploads sign the multipart length; the opencode-go key check sends a session id, so wrong keys no longer pass; combo seats with a `(level)` suffix publish the right context limit; Alibaba-style cache usage is counted once; usage chart labels scale to billions and trillions.
- **Token saver**: optional "REA allow" toggle (off by default) replaces the client's built-in security-policy paragraph with REA reverse-engineering guidance.
- **CLI**: `literouter setup pi` points the Pi coding agent at a LiteRouter server, local or remote. It reads the models your API key can use from `/v1/models` and adds a `literouter` provider to `~/.pi/agent/models.json` with each model's image input, reasoning, context and output limits and thinking levels. Other providers and settings are kept, the previous file is saved as a timestamped `.bak`, the file is written with mode 0600, and `--dry-run` shows the result with the key masked.
- **CLI**: `literouter setup claude-code` sets `ANTHROPIC_BASE_URL` (the server root) and `ANTHROPIC_AUTH_TOKEN` in Claude Code's `settings.json` (`$CLAUDE_CONFIG_DIR` is honoured) and maps the opus, sonnet, haiku and fable tiers to LiteRouter models with `--opus`, `--sonnet`, `--haiku` and `--fable`. Other settings are kept.
- **CLI**: `literouter setup codex --model <id>` adds a `literouter` model provider (Responses API, key sent as a static `Authorization` header) and a `literouter` profile to Codex's `config.toml` (`$CODEX_HOME` is honoured); `--default` makes it the default profile. Only those tables change, and the file is re-parsed before writing so another table is never altered.
- **CLI**: `literouter setup opencode` adds a `literouter` OpenAI-compatible provider to `opencode.json` (`$XDG_CONFIG_HOME` and `$OPENCODE_CONFIG` are honoured) with each model's limits, image input and reasoning variants, and makes the first model the default when none is set (`--default` forces it).
- **Dashboard**: the phone tab bar clears the iPhone home indicator. The viewport now sets `viewport-fit=cover`, without which iOS reports every `env(safe-area-inset-*)` as 0, so the tab bar's bottom padding never applied.
- **Dashboard**: adding LiteRouter to a home screen shows the logo. iOS ignores SVG touch icons, so there is now a 180px PNG `apple-touch-icon`, and the web manifest lists 192/512 PNG icons plus a maskable one in the Route Sheet design (the old indigo SVGs are redrawn to match). The browser tab icon (`favicon.svg`, plus 32/96px PNG fallbacks) is redrawn as the same mark, with its cache-buster bumped to `v=3`. Shared links get Open Graph and Twitter card tags with a 1200×630 `og.png`; the image URL is absolute, built from the request host (`https` behind a proxy that sends `X-Forwarded-Proto: https`) and dropped to a relative path when the host is not a plain hostname. Push notifications use the PNG icon.

# v1.0.0
- **Rewrite**: LiteRouter now runs on the Bun runtime with no Next.js. The server is one `Bun.serve` process, the dashboard is a React SPA built with `Bun.build`, and the Docker image is a compiled musl executable on Alpine (116.3 MB for amd64, 117.8 MB for arm64). The CLI is renamed `literouter` and is now a Bun package (Bun 1.4.4 or newer); its npm release follows later. To migrate, remove the old package with `npm rm -g 9router`, then run the Docker image or run from source. **No config, database or environment changes:** the same `DATA_DIR`, the same SQLite file and the same Docker volume keep working. Measured against the Node build under the same load: idle RSS 115.8 to 57.4 MiB, p50 latency 7.6 to 3.5 ms, p95 latency 20.2 to 11.2 ms.
- **Data dir**: the default data directory is now `~/.literouter` (`%APPDATA%\literouter` on Windows). An existing `~/.9router` is still used when the new directory is absent, and nothing is moved or copied; `DATA_DIR` still wins. The server logs which directory it chose at startup, and the CLI removes the old `9router` autostart entries.
- **Dashboard**: new design ("Route Sheet"). A top bar names every page on desktop. On phones there is a bottom tab bar and a swipeable "More" sheet. Overview shows each recent request wired through /v1 to the provider that served it.
- **Dashboard**: open dashboards now tell you when a new version is deployed. The signal is an X-LiteRouter-Build header on /api responses, so there is no polling and no extra requests. If a page's files have changed after a deploy, the page reloads once automatically.
- **Dashboard**: labels now say LiteRouter. Settings names the data dir (DATA_DIR) instead of a hard-coded home path.
- **Dashboard**: smaller, cleaner front end. The main CSS dropped from 107 KB to 16 KB gzip, with fonts now served as separate cached files. The IBM Plex dependency, dead components and dead CSS are gone.
- **Compatibility**: JSON responses send `content-type: application/json` without `;charset=utf-8`, as the Node image did.
- **Compatibility**: outbound upstream requests send Node's default headers when the caller did not set them: `accept-encoding: gzip, deflate`, `user-agent: node`, `accept-language: *`, `sec-fetch-mode: cors`, and `cache-control`/`pragma: no-cache` for `cache: "no-store"`. Upstream-visible requests are therefore unchanged from production. gzip/deflate decoding is tested for JSON and SSE.
- **Compatibility**: the unknown-`/api` 404 page title matches the Node image.
- **CLI**: the old-server takeover works without a pidfile. It identifies the old server by the port's live listener plus a positive 9router marker, which also covers Linux's `next-server` process name.
- **CLI**: when the listener cannot be identified, `literouter` refuses with exit 1 and a "stop it yourself, or run with `--port <n>`" message. It never kills an unidentified process and never starts a second server on the same data dir.
- **CLI**: `literouter stop` works without `lsof`, falling back to `ss` and then `/proc/net/tcp{,6}`.
- **Tooling**: remove the vitest-to-bun codemod and `port-next-routes.mjs` (its leftover-Next checks now live in `tests/web/no-next-imports.test.js`), the per-file test-count guard and the Node fixture generators.
- **Tests**: remove duplicate cases and collapse same-shape cases (including the Gemini 3.x per-version families) into `describe.each`/`it.each` tables, with no assertion weakened. Add a "Tests stay lean" rule (`AGENTS.md`, `docs/adr/testing.md`) and the CI check `scripts/check-test-hygiene.mjs --check`, which fails on unreferenced fixtures or helpers, assertion-free test files, and duplicate titles in a scope.
- **Repo**: old plans, baseline evidence and reports are deleted, the ADRs are folded into short topic files under `docs/adr/`, the Node-vs-Bun parity corpus is removed, and duplicate tests are cut, with test coverage unchanged. Operations live in `docs/ops.md`.

- **Runtime**: run on Bun end to end. `bun run build` bundles the server and dashboard into `dist/app`, `bun run compile` builds one musl executable, and the Docker image is Alpine plus that executable (116.3 MB for amd64, limit 150 MB). Next.js, Node, npm, `package-lock.json`, `better-sqlite3`, `sql.js`, `undici` and `open` are gone from the repo; `bun:sqlite` is the only database driver.
- **Lint**: the `@next/*` rules left with `eslint-config-next`; `jsx-a11y` and `import` rules are kept, now configured directly in `eslint.config.mjs`.
- **CLI**: the package is renamed `literouter` (Bun 1.4.4 or newer; its npm release follows later; remove the old package with `npm rm -g 9router`), adds a `literouter stop` command, and checks for updates by default (`--skip-update` turns it off).
- **CI**: add the staging image workflow, which publishes only `ghcr.io/<repo>-staging:staging-<sha>`; the deploy scripts accept only `-production:production-<full-sha>` images.
- **Ops**: the compose `NODE_OPTIONS` heap ceiling is replaced by `mem_limit`, since V8's `--max-old-space-size` does not apply on Bun; `BUN_OPTIONS=--smol` is the opt-in knob.
- **Server**: serve the app from `Bun.serve` (`bun src/server/index.js`, `bun --hot` in development) instead of Next's server. Next's `custom-server.js`, `src/proxy.js` and `src/instrumentation.js` are deleted; the route table, guard, trust rules, compression, h2c handling, body limit, timeouts, SIGTERM drain and the optional system CA store now live in `src/server/`. `bun run dev` and `bun run start` run the Bun server, and `dev:bun`, `start:bun` and `dev:webpack` are gone. `next.config.mjs` is deleted.
- **Security**: the per-process peer token is retired. The Bun server reads the peer address from the socket and hands it to the guard through a request context, strips `x-9r-real-ip`, `x-9r-peer-token`, `x-9r-via-proxy` and `x-forwarded-for` from incoming requests, and no source may read `NINEROUTER_PEER_TOKEN` or trust `x-9r-real-ip` (a test enforces it). Behaviour change: a direct loopback request with no proxy marker is now local, which Next never allowed because it added `x-forwarded-*` to every request; Cloudflare to Caddy to loopback stays remote and `TRUST_LOOPBACK_AS_LOCAL=false` still works. `bun --hot` therefore reaches the localhost-only routes in development.
- **Tests**: run `gen-route-table.mjs --check` in CI. The old `custom-server` tests are replaced by `tests/server/peer-headers.test.js`, `h2c.test.js` and `ca.test.js`; `tests/server/no-next-server.test.js` and `tests/web/no-next-imports.test.js` keep Next's pieces from coming back.
- **Removed**: the inert outbound-fetch settings `FETCH_KEEPALIVE_TIMEOUT_MS` and `PROXY_DISPATCHERS_MAX_SIZE` (Bun's `fetch` has no keep-alive TTL or dispatcher cache); the stale-socket replay (`FETCH_FRESH_RETRY`) remains. `scripts/copy-standalone-assets.mjs` is deleted.
- **Kenari**: show the live Kenari catalog in the dashboard and take thinking levels from it. `/api/providers/[id]/models` serves the cached catalog for `kenari` (chat models with server-resolved `caps` and `thinkingLevels`; image/tts/stt/video/music keep their kind and stay out of the LLM pickers; empty cache falls back to the static list), the model picker and provider page use it like cursor/cline, and `/api/models` carries the live-only models so the picker gets correct limits. The sync now keeps `reasoning`, `reasoningToggle` and `reasoningLevels` (known levels only; older files still read). `getThinkingLevels` for `kenari`/`kn` returns Kenari's `supported_reasoning_levels` (with `none` only when `reasoning_toggle` is true; none for non-reasoning models), reasoning turns on and `thinkingCanDisable` follows the toggle. On the wire, Kenari models now use the shape of the transport (chat `reasoning_effort`, responses `reasoning.effort`, claude `output_config.effort`) with advertised levels passed through unchanged (no xhigh/max clamp, no responses minimal-to-low clamp), and `none` on a model that cannot disable thinking becomes its lowest advertised level. Regression test: `tests/unit/kenari-thinking.test.js`.
- **Kenari**: sync Kenari's own model list daily (`https://kenari.id/v1/models`, public) into `DATA_DIR/kenari-catalog.json` and treat it as authoritative for the `kenari` provider (and its `kn` alias). `getCapabilitiesForModel` now takes context/output limits from it over every table and the models.dev overlay (limits when > 0, modalities only turned on), through a new optional `getProviderLive` hook on the catalog source, so `/v1/models`, `max_tokens` handling, translators and combos all agree (e.g. `muse-ember-1-0` 1048576/524288 instead of 200000/64000). `/v1/models` also lists Kenari's live models from the cached file (no request-path fetch; image/tts/stt/video/music stay out of the LLM list; the `:free` variants are separate entries and match exactly). Fails open on network errors, corrupt or missing files. 60s startup delay, 24h interval, 30min retry; `KENARI_CATALOG_SYNC=off` disables it. Pricing is unchanged. Regression tests: `tests/unit/kenari-catalog.test.js`, `tests/unit/v1-models-kenari-live.test.js`.
- **Security**: every streamed response carries `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` (shared `SSE_NO_COMPRESS_HEADERS` in `open-sse/utils/sseConstants.js`, used by the open-sse executors, `/api/usage/stream`, `/api/console-logs/stream`, the Gemini native route and System One passthrough), and re-streamed upstream bodies no longer forward stale `Content-Encoding`/`Content-Length` (commandcode), so SSE is never gzipped or buffered. Regression test: `tests/unit/sse-no-compression.test.js`.

- **Security**: close four audit gaps. Dashboard routes that spawn processes or read host secrets (`/api/pxpipe/install`, `/api/pxpipe/start`, `/api/headroom/{start,stop,proxy,restart}` and `extras` POST/DELETE) now return 403 to remote callers even when `requireLogin=false`, and the `extras` GET the dashboard renders stays available. The h2c downgrade path caps bodies at `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` (413 above it), times out stalled senders, and answers chunked/`Transfer-Encoding` upgrades with 411 instead of silently dropping the body. Login lockout reserves the attempt before the bcrypt compare, so parallel guesses cannot all pass `checkLock`, and a loopback proxy's client IP now comes from `X-Real-IP` or the rightmost `X-Forwarded-For` hop rather than the client-controlled leftmost entry. The one-time legacy JSON import now fingerprints the usage data it brings over (`usageHistory.apiKey` and the `usageDaily` per-key buckets) instead of storing raw client keys; `apiKeys.key` stays as-is because it is the live credential, so imported legacy keys keep authenticating. The rightmost-`X-Forwarded-For` rule assumes exactly one trusted loopback proxy hop.
- **Removed**: `/api/usage/history` and `/api/usage/logs` (removed in #168). Use `/api/usage/stats?period=all` and `/api/usage/request-logs` instead.
- **Dashboard**: turn `/dashboard/systemone` into a form-based System One Lab. State is edited as text, key/value fields, or validated JSON; questions are built with type-specific cards (yes/no criteria, choice options, ordered score levels, box), images are uploaded or pasted into base64 assets with an insertable placeholder, and four official templates load in one click. Answers render as verdicts, probability bars, score distributions and box overlays, 422 `loc` errors highlight the matching question, and the raw JSON stays available in an advanced two-way-synced editor plus "Copy as curl" with a placeholder key. The form persists in localStorage. `POST /v1/systemone` now forwards only the `TypeSafe-Danger-Zone-Images` and `TypeSafe-Danger-Zone-Long-Context` client headers so image and long-context requests reach the provider; the body stays pass-through. Regression test: `tests/unit/systemone-lab.test.js`.

- **Ops**: point the deploy health gates (`scripts/deploy.sh`, `scripts/post-deploy.sh`) at `https://ai.musaddiqr.com/api/health` and move the dashboard same-origin fixture to the same hostname, so no repo script or test depends on the unredirected `ai.investdx.biz.id` name. Docs updated where they describe current state. Refs #143.
- **Security**: stop the production image trusting a bundled CA store. The image sets `LITEROUTER_SYSTEM_CA=1` and the server installs the system CA store once before it starts serving (`src/server/ca.js`), so patching `ca-certificates` in the image removes a distrusted root such as the eMudhra chain. It refuses to start if the system store is empty. The runner stage installs `ca-certificates` explicitly. Installs without the env var are unchanged. Regression tests: `tests/unit/system-ca-trust.test.js`, `tests/server/ca.test.js`. Refs #123.
- **Security**: stop storing client API keys in plaintext. Request-log files (`1_req_client.json`, `2_req_source.json`, `4_req_target.json`), `usageHistory.apiKey`, the `usageDaily` per-key buckets, the history export and the debug auth line now carry `fp_<16 hex>`, a keyed HMAC-SHA256 (`API_KEY_SECRET`) fingerprint: stable per key, so clients stay distinguishable, and not reversible. Upstream provider credentials in `4_req_target.json` are redacted; route, provider, URL and status are kept. Migration 003 rewrites existing `usageHistory` and `usageDaily` rows on next boot. **Rotate client keys anyway**: it cannot scrub existing `logs/` files, earlier DB backups, or freed SQLite pages/WAL; delete old `logs/` and treat pre-change backups as exposed. Changing `API_KEY_SECRET` re-labels fingerprints (history splits); stats keys shown in the dashboard are now `fp_...` instead of `sk-xxxxxxx***xxxx`. Refs #136.
- **Upstream intake** (upstream `3a978a63..1fe586bb`): return the upstream error status for an SSE error frame on a non-streaming request instead of a 200 success; normalize NVIDIA NIM assistant `reasoning` to `reasoning_content`; send the CodeBuddy plugin request/conversation id headers on CN and intl so the gateway's channel check stops rejecting every call with `400 / 11128`.
- **Ops**: retire the automated Codex upstream-intake controller. Remove `scripts/upstream-intake.sh`, its model broker (`upstream-intake-proxy.cjs`), Codex config, env file, systemd service/timer, the clone-retention library and their unit tests, and the runbook's intake-retention section. Upstream intake is now a manual reviewed PR (see AGENTS.md and the promotion plan). No gateway, dashboard or deploy behaviour changes; installed host units are not touched by this change.
- **Usage**: count Claude prompt cache once when an OpenAI-format client streams from a Claude upstream (the stored prompt, cost and cache-hit ratio counted cache read + write twice), and report the cache split to clients: `prompt_tokens_details` on streamed and non-stream Claude → OpenAI responses, `cache_read_input_tokens` / `cache_creation_input_tokens` on non-stream OpenAI/Responses → Claude responses. Reporting and cost accounting only; upstream consumption and cache hits are unchanged, Claude Code passthrough is unaffected, and rows stored before this change keep their inflated values. LiteRouter equivalent of upstream #5213. Refs #130.
- **Upstream intake** (upstream `87a74e1b..3a978a63`, refs #126): advance a combo past "insufficient credit" / "credit balance is too low"; fill missing ids on streamed tool-call fragments and restore fingerprint-renamed tool names on the passthrough stream; strip NUL bytes from every bound SQLite string; convert OpenAI `image_url` parts inside tool messages to Claude images; keep adaptive thinking for Haiku 5+ on the Claude passthrough; rename `max_tokens` to `max_completion_tokens` for the OpenAI provider; keep effort `max` for GPT-5.6 / GPT-6 on OpenAI-compatible nodes; send DeepSeek V4.1 Flash as `deepseek-flash` upstream; OpenCode Free reasoning fixes (MiMo alias lift, DeepSeek low|high|max, GLM-5.3-flash-free `reasoning_effort`, 330k DeepSeek window). Bind the optional dev Headroom port to loopback.
- **Ops**: mount intake instructions in the sandbox's temporary Codex home so failed runs leave no `AGENTS.md` artifact in disposable clones. Keep retention's local-work guards unchanged. Refs #121.
- **Upstream intake**: resolve Cursor Auto from the account catalog; fail closed before AgentService HTTP/2 when strict proxy or relay intent cannot be honored; retain empty-turn rejection and add KV metadata regression coverage.
- **Protocol**: correct OpenCode session timestamps and missing reasoning history; preserve OpenCode Free reasoning capabilities; drop unsupported DeepSeek response formats and Gemini 4 sampling parameters; order Gemini 4 tool responses last; honor Vertex API-key project/location. Retire Codex GPT-5.5 catalog entries and auto-ping defaults without restoring media code.
- **Database**: expose no-auth free models while honoring disabled models; atomically prune deleted-node custom models with exact prefixes and invalidate the cache; count input/output-token usage rows while retaining masked API-key buckets. Isolate Zed auth tests from the real database; preserve the requested model in forced-SSE Claude JSON and extend regressions without replacing the fork's converter.
- **Ops**: add `scripts/deploy.sh <full-main-sha>` — the manual deploy, unchanged in behaviour, which now removes the `production-<full-sha>` tag it replaced. It verifies the container reports `healthy` and that `https://ai.investdx.biz.id/api/health` answers **before** removing anything, so a failed deploy stays rollback-able; it aborts rather than guess if the running tag cannot be determined, and never builds locally or deploys `latest`. This replaces the hourly image-retention timer, which was over-built and never pruned anything: one file at the moment the replaced tag becomes known is enough. `scripts/post-deploy.sh` stays as a manual manifest/reconcile tool. Refs #117.
- **Ops**: add a pre-deploy reclaim step to the runbook — the host tree must be on the merged main SHA and merged worktrees/branches are reclaimed before deploy, with the merge proof, the never-reclaim list, and the cleanup evidence recorded. Refs #113.
- **Providers**: record each model test outcome — pass or fail — against its own model, so a passing test leaves a visible timestamped trace on that row (a pass emits no server log line at `LOG_LEVEL=WARN`, so only failures used to appear anywhere) and one model's failure is no longer displayed while a different model's row is being tested.
- **Dashboard**: make the model test a first-token probe — it now streams, resolves on the first token and cancels the rest of the generation instead of waiting for a full response under a hardcoded 15 s abort, which reported healthy-but-slow models as broken while the upstream call still completed and was billed. The budget moves to `MODEL_TEST_TIMEOUT_MS` (default 200 s, the router's own first-chunk budget), latency is time-to-first-token, and a timeout returns a 504 "may be slow, not unreachable" instead of a bare 500 carrying a raw abort message.
- **Providers**: validate the Kenari connection against its auth-gated quota endpoint, so the connection test stops answering "Provider test not supported" for a first-class provider. `/v1/models` is auth-blind (it answers 200 for any key) and cannot distinguish a valid key from a revoked one.
- **Ops**: document both required retention tag variables; explicit previous tag `none` safely skips all cleanup when no rollback release is known, while unset inputs still fail closed. Refs #104.
- **Ops**: add a dry-run-first, documented host-side post-deploy image retention step: N=2 (running and previous release), with all container-referenced tags/IDs protected and fail-closed health/inventory checks. No automatic deployment changes or historical cleanup. Refs #104.
- **Ops**: bound upstream-intake clone retention. Failed runs now remove clones that hold nothing unpublished, and a startup GC removes only idle (`UPSTREAM_INTAKE_RETAIN_DAYS`, default 14) clones whose work is merged/published to `origin-literouter` or upstream-only; unpushed, dirty, unknown or unverifiable clones are kept. Tags, remote-tracking refs and reflog-only commits must already exist in the host repo, and `retention_manifest` lists candidates read-only (no fetch, no removal) before any deletion. Refs #103.
- **Claude**: when Opus rejects `thinking: disabled` and asks for adaptive thinking, retry once with `thinking: adaptive` and low `output_config.effort` so `reasoning_effort: "none"` no longer fails.
- **Claude**: map `tool_choice: "none"` to Claude's `none`; rewrite MCP-style tool names (dots) the upstream rejects and restore them in responses; complete streamed no-argument tool calls with `{}`; and retry once without forced `tool_choice` or with `thinking: between_tools` when Sonnet/Opus reject them.
- **Tool calls**: forward `tool_choice` (`required`, `none`, named function) and `parallel_tool_calls` from Chat Completions to Responses upstreams such as Codex, and rewrite tool names outside `[a-zA-Z0-9_-]` (for example MCP `server.tool`) for the upstream while restoring the original name in responses.
- **Streaming**: send the `data: [DONE]` sentinel to Chat Completions clients served by Responses, Claude, and other translated upstreams, which never emit one themselves.
- **Responses**: return a Responses-shaped body (`output` items, `function_call` for tools) for non-streaming `/v1/responses` requests served by Claude, Gemini, and other non-OpenAI upstreams, instead of a raw `chat.completion`.
- **Codex**: map `reasoning_effort: "none"` to the lowest supported level for `gpt-6.1-sol` (which rejects it upstream), and return the upstream error for non-streaming requests whose Responses stream fails or ends without a result instead of an empty 200 with `finish_reason: "in_progress"`.
- **System One**: reject chat requests to System One-only providers with HTTP 400 directing clients to `POST /v1/systemone`, before credential lookup or upstream fetch. Classify Jev as System One and exclude System One-only providers from the default chat catalog, retaining explicit System One discovery.
- **Cursor**: forward reasoning effort to AgentService; reject empty turns and avoid successful completion on transport failures.
- **Capabilities**: recognize the hyphenated DeepSeek V4.1 Flash vision alias without changing the GA model limits.
- **Performance**: stop O(n²) re-splitting of partial SSE lines in the stream translator, Responses stream-to-JSON converter, and GitHub/CommandCode executors; reuse the stall timer per chunk; cache compiled pricing/capability glob regexes; bound the token-refresh dedup map; count RTK lines without splitting large tool results.
- **Performance**: skip per-row deep clones of the connection pool on read-only paths (`/api/providers`, `/api/models/availability`, `/v1/models`, usage stats, account cooldown); aggregate usage "last used" overlays in SQL; release usage SSE listeners on client abort; invalidate the custom-model cache after raw SQL upserts.
- **Dashboard**: lazy-load recharts (usage chart) and @dnd-kit (combo editor); pause request-log and model-availability polling while the tab is hidden; fix duplicate quota-poll timers after background refreshes; skip the i18n DOM pass while the locale stays English and cache loaded literals.
- **Cleanup**: remove unreachable modules (broken legacy OAuth service classes, unused barrels, Grok Build config, Qoder shims, provider-limit cards, RTK registry, compact/combo duplicates), ~60 unused exports, and the unused `confbox`, `express`, `http-proxy-middleware`, `selfsigned`, `socks-proxy-agent`, and `chalk` root dependencies.
- **Models**: include explicitly enabled non-LLM models when filtering kind catalogs by provider service kind.
- **Tests**: invoke the single-model catch-all handler directly so key-access coverage does not depend on Next.js route precedence.
- **Models**: keep single-model `/v1/models/{provider}/{model}` lookups while removed capability-list paths return 404.
- **Models**: restore `/v1/models/{kind}` key-access-filtered catalog lookups.
- **Tests**: pin key-access model-kind fixtures to explicit static models, avoiding environment-dependent catalog behavior.
- **Chat routing**: restore the missing upstream-error header helper import.
- **Tests**: pin key-access model-kind fixtures to explicit static models, avoiding environment-dependent catalog behavior.
- **Key access**: include the System One test model in the restricted-key allow-list fixture.
- **System One**: enforce resolved provider/model access after request normalization.
- **Tests**: isolate provider priority tests from the real user database.
- **Models**: resolve nested combo capabilities through provider-aware seat lookups before default fallbacks.
- **Thinking**: keep Codex GPT-5.6 reasoning effort in Chat Completions wire form for Responses requests, with Responses-only minimal clamping for Codex Luna.
- **System One**: import the API-key model-access enforcement helper used by request validation.
- **Models**: preserve provider aliases in combo seat capability lookup and carry Grok CLI proxy-pool policy through model discovery.
- **Muse**: keep the shared Muse Spark thinking wire on OpenAI Chat while preserving the Responses transport.
- **OpenCode**: keep translated conversation sessions valid for recent inverted timestamps and stable within the bounded translation cache.
- **Cursor**: distinguish auto-default selection from first-agent fallback in diagnostic logs.
- **Dashboard**: correct Codex auto-ping model documentation.
- **Auth**: remove duplicate strict proxy metadata assignments.
- **System One**: resolve API-key model access before request validation so restricted keys cannot probe catalog behavior.
- **Database**: preserve restricted-key access settings in cached API-key lookups.
- **Errors**: forward upstream rate-limit headers from provider error responses.
- **Intake fixes**: restore OpenAI-Responses thinking wire format, GLM 5.2/5.3 1M context windows, nested combo seat limits, `/v1/models?kind=`, System One auth ordering, tool-name mapping, and the Combos page nested lookup prop.
- **Chat routing**: restore Cursor pre-translate RTK, Codex compaction validation, cross-provider tool dedupe, and proxy-aware credential refresh.
- **Models**: resolve provider aliases before capability lookup so provider-specific catalog limits apply consistently.
- **Models**: fix combo capability aggregation, restore Claude Sonnet 5.5 and GLM 5.3 limits, and filter `/v1/models/{kind}` lookups by API-key access.
- **Providers**: restore Muse Spark Responses routing and Netlify relay pool resolution.
- **Models**: resolve nested combo seat limits through the same resolver as combo capabilities, preserving provider-scoped context limits.
- **Thinking**: keep transport-specific `openai-responses` thinking overrides while preserving provider-specific GLM and Muse formats.
- **Security**: enforce API-key model access on System One before credential lookup.
- **Proxy pools**: stop Netlify relays from advertising compressed bodies after buffering them and fail deploy polling immediately on status errors.
- **Database**: create the `kv` table before versioned migration cleanup on legacy databases.
- **Models**: import the missing combo capability aggregator used by `/v1/models`.
- **Models**: expose `/v1/models/{kind}` as a kind lookup while preserving single-model 404 behavior, and normalize UI-alias combo seats to provider IDs.
- **Models**: restore Sonnet 5.5 pattern matching, OpenCode Go Luna/GPM overrides, and catalog-backed combo capabilities.
- **Providers**: declare the Muse Responses transport so Responses-only models route to the matching endpoint.
- **Migrations**: create `kv` before legacy-data cleanup, and preserve relay header filtering for compressed responses.
- **Models**: import the provider registry so capability lookups resolve aliases without a startup error.

## Model Metadata (2026-10-10)
- **Registry**: add missing static catalog entries — Anthropic (Opus/Sonnet/Haiku 5.5, Fable 5), OpenAI (GPT-6 family, 5.5/5.4-pro/5.2-pro, 5.3-codex(+spark)), xAI (Grok 4.7/4.3, Grok Build 0.1), DeepSeek GA deepseek-flash, MiniMax M2/M2.7/M2.5-highspeed, Perplexity Sonar Reasoning Pro / Deep Research, Poolside Laguna M.1, Cerebras Qwen3.8 27B.
- **Capabilities**: correct windows for Grok 4.7 (500k) and 4.3 (1M), DeepSeek GA flash (1M/384k), Laguna M.1 (262k), Sonar reasoning variants; add vision for gpt-5.3-codex and Qwen3.8 27B; adaptive thinking for Claude 5.5 tier.

## Upstream Core Fixes (2026-10-07)
- **Claude**: cache final tool results within the existing four-breakpoint budget.
- **Models**: correct provider-scoped context/output limits and publish nested combo minima without restoring broad capability aggregation or UI features.

## Features
- **Codex**: add native `gpt-6.1-sol` catalog support using the existing Codex Responses transport and Standard token pricing for usage estimates
- **System One**: add `/v1/systemone` TypeSafe pass-through with a dedicated provider catalog, model-aware request workspace, connection testing, API-key setup, registry validation, and upstream header pass-through
- **System One**: route custom node prefixes and Cloudflare Clef/Clef-Flash model IDs through `/v1/systemone`, validate System One node keys with an auth-only probe, reject duplicate or reserved node prefixes, and scope `/v1/models?kind=` to the requested kind
- **System One**: apply the SSRF guard to custom node base URLs at creation, derive reserved prefixes from the provider registry, serve `/v1/models/{id}` for the requested kind, and use the correct Cloudflare Clef run URL template
- **System One**: add custom System One provider nodes (name, prefix, base URL, optional model catalog) with dashboard creation, model listing, request handling, and connection validation, plus built-in Cloudflare Clef and Clef-Flash System One support

## Security
- **Provider connections**: require explicit `allowOverwrite: true` before replacing same-name API-key credentials, including direct repository callers; OAuth identity refresh remains unchanged
- **Usage**: mask API keys in live and daily statistics object keys, including the daily last-used overlay, without exposing stored credentials
- **Provider validation**: `/api/provider-nodes/validate` and the Azure/Cloudflare branches of `/api/providers/validate` now fetch through the SSRF-guarded `fetchPublic` instead of a raw `fetch`, so a caller-supplied base URL can no longer 30x its way to an internal target (metadata endpoints included). Remote callers are pre-rejected with 400; the trusted local operator keeps LAN nodes (LM Studio, vLLM, ollama-compat), including LAN targets reached through a redirect hop — `allowPrivate` is now a per-hop decision rather than a one-shot gate
- **Local-operator trust**: the spoofable `Host` fallback no longer exists in any environment. Local-operator access is decided from the socket peer address (see the peer-token entry above), so a request that arrives through a proxy does not inherit LAN-node validation or the localhost-only routes.

## Fixes
- Restore `/v1/models/{kind}` lists while keeping per-key access filtering
- **Claude**: bump the Claude Code CLI fingerprint to 2.1.295 so Opus 5.5 passes the version gate (upstream requires >= 2.1.280).
- **Combo fallback**: treat upstream context-length 400s as model-scoped and try the next combo model immediately without cooling the account down; other request-scoped 4xx still return directly.
- **Codex native compaction**: preserve the client's remote-compaction beta header on `/responses`; retry upstream response-protection outages before streaming, then return a real 503 instead of an empty successful stream.
- **Codex compaction**: route compact requests using request-local state, keep the compact endpoint JSON-only, preserve encrypted compact output, and reject malformed compact responses instead of recording empty SSE success.
- **Antigravity OAuth**: allow a validated `ANTIGRAVITY_REDIRECT_URI` runtime override, reuse the server-selected URL during exchange, enable automatic same-origin hosted callbacks, ignore callbacks from other login attempts, and prevent duplicate code exchanges. Public callbacks still require Google OAuth client approval; localhost/manual paste remains the default.
- **Responses completion**: allow `PENDING_COMPLETION_FLUSH_MS` to configure the deferred-completion watchdog through the existing positive timeout parser; retain the 3000 ms default for missing or invalid values. Add configuration regression coverage.
- **Responses usage**: preserve integer upstream token totals at least as large as input plus output; derive totals only when absent, malformed, or below the component sum. Cover larger provider totals and invalid totals without changing completion timing or placeholder handling.
- **CodeBuddy**: share frequency-limit error parsing across CN and international executors; preserve reset timezones and HTTP-error fallback with regression coverage for both providers.
- **Proxy pools**: return a controlled 503 when chat credential/proxy lookup fails; atomically reject deletion of pools referenced by connections or provider strategies with 409. Distinguish missing pools from unconfigured proxies without permitting direct-IP fallback when the deleted pool's policy is unknown.
- **Strict proxy / Codex**: carry resolved strict-pool policy through credential selection, inference, refresh retries, quota checks, and Grok model discovery so unusable pools cannot silently route directly; refresh the Codex provider baseline for the 0.159.0 CLI identity.
- **Codex / Kiro**: restore the Codex CLI version header; map OpenAI `max` effort to Claude `high` while preserving explicit native Kiro `max` and GPT `xhigh`. Cover both Codex stream modes and effort-source precedence; retain real Claude trailing-turn normalization in force-stream tests and align Grok golden headers with the configured 1.0.44 identity.
- **Core upstream intake (2026-10-01)**: preserve Claude file uploads and terminal conversation roles, normalize DeepSeek tools/thinking and Gemini schemas, retain late Responses usage with a bounded 3-second completion wait, refresh Grok/Codex protocol identities, avoid stale Codex refresh-token reuse, preserve strict proxy routing even when a pool is unusable, deleted, or unreadable, and map CodeBuddy frequency limits to account fallback. Isolate provider-priority DB regressions without removing LiteRouter coverage; no new providers, UI, CLI, tunnel, MITM, or cloud-sync features.
- **Upstream intake**: wait for host capacity instead of abandoning repairs, resume pending intake PRs after controller failures, and check deployment health inside the container's network.
- **Request logs**: lower the production debug-log size limit from 1024 MB to 500 MB.
- **Upstream intake**: fix scheduled startup and merge-SHA deployment; isolate ephemeral `--yolo` agents from host networking and credentials behind a model-only Unix-socket broker; delegate all installs/builds/tests to CI, wait for current-head CI/Hermes, repair completed blockers, retain failures, dispose after successful deployment
- **Upstream intake**: make the repair-attempt ceiling configurable via `UPSTREAM_INTAKE_MAX_REPAIRS` (default 3) so unattended runs keep resolving reviewer blockers instead of stopping
- **OAuth**: keep same-identity credential refresh independent of the API-key name-collision overwrite flag, including callers passing `false`
- **OpenCode**: reconcile Free Muse tool-choice and reasoning regression checks with the required cloaked fingerprint quartet; retain caller tools, input, and the 1.3 Free auto-only policy
- **Usage**: distribute view and period controls across the toolbar on desktop and keep the provider topology aligned with the Recent Requests panel height
- **Usage**: keep Total requests as the hero metric while stretching the supporting token/cost cards to the same desktop height
- **Branding**: replace the legacy indigo tab icon with a neutral theme-aware LiteRouter favicon and retire the stale file-based ICO override
- **Usage**: align the Overview/Details switch with the period selector after the observability header refresh
- **System One**: include TypeSafe in live usage topology and animate active provider requests
- **System One**: record TypeSafe Jev input/output usage and cost in dashboard usage history
- **System One**: dashboard requests now forward an active LiteRouter API key; TypeSafe credentials remain upstream-only and public endpoint authentication stays required
- **Endpoint**: stop advertising Cloudflare Tunnel and Tailscale in the minimal profile; the page no longer polls `/api/tunnel/status`, which is not served there
- **Console Log**: retain the page in the minimal profile and move its API to `/api/console-logs`; it previously sat under the hidden `/api/translator` prefix, so pruning the translator playground silently took the log stream down with it. Its sidebar group was also blanked wholesale, which discarded the retained entry regardless of its own flag
- **Sidebar**: hide the external 9English link in the minimal profile so the sidebar carries only product navigation
- **Round-robin**: persist the account cursor off the request path and invalidate the connection cache before the first await, so a selection can never read a stale cursor

# v0.5.81 (2026-09-18)

## Features
- **Xiaomi MiMo**: MiMo Desktop support merged into `xiaomi-mimo` with API-key and Desktop/OAuth dual auth.
- **Claude Code**: a 1M-context toggle and a dashboard-driven auto-compact window.
- **Models**: DeepSeek-V4.1-Flash added to DeepSeek, CodeBuddy-Intl and Ollama, and Persian (fa) translations.

## Fixes
- **OpenCode**: free-tier 403 and 429 errors resolved with a canonical session format and stable session reuse.
- **Stream**: aborts after HTTP 200 are now reported in-band as per-format error frames.

# v0.5.75 (2026-09-10)

## Features
- **Video**: OpenRouter and Vertex AI (Veo) video generation on `/v1/videos/*`.
- **Antigravity**: weekly quota tracking and free-tier handling.
- **Codex**: GPT Image 2.5, Flare and Sunburst image models.
- **OpenCode Go**: newly published models added across the chat, messages and Responses transports.

## Fixes
- **Claude**: cache breakpoints capped at the 4-marker budget, which stops a spent budget from triggering a full combo failover.

# v0.5.69 (2026-09-05)

## Features
- **Codex**: GPT 6.0 Astra added with vision, thinking and search capabilities.
- **Usage**: Claude Fable quota tracking with weekly window normalization.
- **Gemini**: `thoughtSignature` persisted and replayed per session namespace.

## Fixes
- **Security**: the cowork MCP tools probe is guarded against SSRF.
- **Antigravity**: Google anti-abuse rate limits are avoided during multi-account token refresh.

# v0.5.65 (2026-09-03)

## Features
- **Claude**: Claude Fable 5.1 support with adaptive thinking and `output_config.effort`.
- **Gemini / Antigravity**: Gemini 3.8 Flash support.
- **Quota**: Groq usage and rate-limit tracking from `x-ratelimit-*` headers.

## Fixes
- **Security**: SSRF guard bypasses closed for alternate IPv6 encodings, trailing-dot hostnames and wildcard DNS.
- **Chat**: a 503 is returned when every credential is rate-limited.

# v0.5.59 (2026-08-29)

## Features
- **Search**: Antigravity and Xquik web search providers on `POST /v1/search`.
- **Models**: a daily, strictly additive model-capability sync from models.dev.
- **Antigravity**: quota-aware routing that skips only the exhausted account and model pair.

## Fixes
- **Stream**: usage is recorded when a client closes on the terminal event, and the trailing NDJSON line of an Ollama stream is parsed.
- **Usage**: nested `cached_tokens` are preserved, so cache hits are no longer billed at the full input rate.

# v0.5.55 (2026-08-14)

## Features
- **Auth**: native SAML 2.0 SSO alongside OIDC.
- **OpenCode-Go**: requests route by declared transport instead of being forced through `/messages`.
- **Usage**: Claude quota calls are deduplicated and cached to stop 429s from multiple tabs.

## Fixes
- **Claude**: passthrough cache breakpoints are re-anchored so the conversation tail is no longer re-cached on every request.
- **Kiro**: chat is intercepted via `x-amz-target` for Kiro IDE 1.0.228 and later.

# v0.5.50 (2026-08-05)

## Features
- **Providers**: TokenRouter and self-hosted STT, TTS and embedding providers added.
- **Combos**: the vision and audio capacity adapter is enabled by default.
- **Qoder**: Personal Access Token connections supported end to end.

## Fixes
- **Claude**: a global header cache that leaked one client's identity was removed.
- **Usage**: cached prompt tokens are no longer lost in the forced SSE-to-JSON path.

# v0.5.45 (2026-07-30)

## Features
- **Providers**: Poolside and nine more OpenAI-compatible providers added.
- **OAuth**: Zed, Trae and Windsurf providers added.
- **Claude**: the default Opus is now `claude-opus-5`.

## Fixes
- **Refresh**: `refresh_token` is rotated between retry attempts.
- **Kiro**: tool history is canonicalized and API keys route correctly.

# v0.5.40 (2026-07-20)

## Features
- **Kimi**: OAuth merged into a dual-auth provider with K3 and K2.7 models.
- **Dashboard**: an animated provider topology flow.

## Fixes
- **DB**: a `better-sqlite3` parameter binding crash was resolved.
- **Cursor**: HTTP/2 AgentService support added.

# v0.5.35 (2026-07-16)

## Features
- **xAI**: Grok Imagine video generation on `/v1/videos`.
- **GitHub Copilot**: Claude models route through Copilot's native `/v1/messages`.
- **RTK**: an `X-LiteRouter-Token-Saver` header bypasses token savers per request.

## Fixes
- **Providers**: bulk-added API keys no longer overwrite existing keys.
- **Thinking**: an explicit adaptive `thinking` block is sent alongside `output_config.effort`.

# v0.5.30 (2026-07-10)

## Features
- **Providers**: Perplexity Agent API, Grok CLI and Featherless presets added.
- **PXPipe**: multimodal prompt compression added as a token saver.
- **Proxy pools**: an auto-rotate strategy for no-auth providers.

## Fixes
- **DB**: a backup is taken on schema change.
- **Codex**: bare-email OAuth deduplication is avoided.

# v0.5.20 (2026-07-07)

## Features
- **Thinking**: a per-model thinking level picker on the provider page.
- **RTK**: a JS-native git-log filter.

## Fixes
- **Thinking**: the `(level)` suffix is stripped from the upstream model name so providers stop rejecting requests.
- **Claude**: `max_tokens` is reconciled against the thinking budget.

# v0.5.18 (2026-07-03)

## Features
- **Usage**: cached tokens are tracked and cost is corrected for input, output and cache.
- **Providers**: ClinePass added, with new NVIDIA models.

## Fixes
- **Kiro**: IdC auth routes to the regional CodeWhisperer surface.
- **Translator**: strict Anthropic content block compliance.

# v0.5.15 (2026-06-29)

## Features
- **Providers**: Kimchi OAuth provider added.
- **Codex**: an opt-in quota keep-alive auto-ping.

## Fixes
- **Responses**: `response.done` terminal events are handled.
- **Gemini**: contents are normalized to prevent 400 invalid-argument errors.

# v0.5.12 (2026-06-26)

## Features
- **Dashboard**: a token-saver page and bulk delete for provider connections.
- **Providers**: Venice AI added, and Kiro external IdP import for Microsoft SSO.

## Fixes
- **Usage**: streaming usage is no longer double-counted.
- **Stream**: non-JSON SSE lines and duplicate `[DONE]` markers no longer break clients.

# v0.5.8 (2026-06-21)

## Features
- **Antigravity**: native image generation support.
- **CodeBuddy CN**: API key auth and a credit quota tracker.

## Fixes
- **Headroom**: Docker sidecar proxy supported.
- **Translator**: tools are normalized to the Anthropic-native shape for non-Anthropic providers.

# v0.5.6 (2026-06-20)

## Features
- **Headroom**: proxy lifecycle management with a dashboard UI.
- **CodeBuddy CN**: a new OAuth provider with a 15-model catalog.

## Fixes
- **CLI tools**: JSONC configs are tolerated in all settings routes.
- **Combo / Fusion**: tool messages are flattened in panel calls to prevent 503s.

# v0.5.4 (2026-06-18)

## Fixes
- **Kiro**: thinking effort budgets are honored.
- **Combo / Fusion**: tool history is flattened in panel calls to prevent 503s.

# v0.5.2 (2026-06-17)

## Features
- **Combos**: a Fusion strategy that fans the prompt out and has a judge model synthesize, plus a per-combo strategy selector.
- **Kiro**: headless API-key auth and a direct `claude` to `kiro` route.

## Fixes
- **Claude**: the OAuth usage endpoint is no longer hammered, so 429s stop.
- **Security**: reverse-proxy local-access trust hardened, and SSRF hardening on web fetch.

# v0.4.80 (2026-06-13)

## Features
- **Providers**: Vercel AI Gateway embeddings, images and credit usage, and the MiMo Free no-auth provider.
- **Codex**: bulk account import via JSON.

## Fixes
- **Security**: re-authentication on database export and import, and an SSRF guard on web fetch.
- **Auth**: rate limiting uses the real client IP and a remote default-password guard was added.

# v0.4.71 (2026-06-06)

## Features
- **Providers**: MiniMax-M3 and Qoder model discovery.
- **Antigravity**: the `gemini-3.5-flash-extra-low` model.

## Fixes
- **Codex**: streaming timeouts hardened and the OAuth refresh lifecycle made durable.
- **Claude**: a forced `tool_choice` 400 on the `cc/` OAuth route was fixed.

# v0.4.66 (2026-05-29)

## Features
- **Providers**: Qoder added with device-flow OAuth and a live model catalog.
- **Models**: Claude Opus 4.8 and GPT 5.4 Mini added.

## Fixes
- **DeepSeek**: `reasoning_content` is echoed back on follow-up and tool-call turns.

# v0.4.63 (2026-05-26)

## Fixes
- **GitHub Copilot**: Gemini and Claude models are no longer routed to the `/responses` endpoint.
- **Stream**: the stall timeout was lowered to 35s for faster hang detection.

# v0.4.62 (2026-05-26)

## Features
- **Proxy pools**: Cloudflare Workers and Deno Deploy relays added.

## Fixes
- **Codex**: upstream drops mid-stream are retried automatically, and random 400 and 404 errors were fixed.
- **MITM**: Antigravity 2.x supported.

# v0.4.59 (2026-05-21)

## Fixes
- **OAuth**: the login flow on Windows was fixed.

# v0.4.58 (2026-05-21)

## Features
- **Providers**: xAI Grok added with OAuth, API key and image support.

## Fixes
- **Tailscale**: connection status on Windows was fixed.
- **Stream**: pipe errors on client disconnect or abort were fixed.

# v0.4.55 (2026-05-18)

## Features
- **Xiaomi MiMo Token Plan**: a region selector for Singapore, China and Europe.
- **Antigravity**: a risk confirmation dialog before the first connection.

## Fixes
- **Stream**: false-positive stall timeouts on Claude reasoning and Kiro responses were fixed.
- **Tunnel**: a tunnel that could not be re-enabled after disable was fixed.

# v0.4.52 (2026-05-17)

## Features
- **Providers**: Vercel AI Gateway support added.
- **RTK**: Kiro format tool-result compression added.

## Fixes
- **OpenClaw**: the `{primary, fallbacks}` agent model form is normalized.

# v0.4.50 (2026-05-16)

## Fixes
- **Tray**: the duplicate tray icon on macOS and the broken hide-to-tray on Windows and Linux were fixed.
- **Dashboard**: the Shutdown button now works.

# v0.4.49 (2026-05-16)

## Features
- **Kiro**: full provider support with request and response translation and live model listing.
- **RTK**: a `buildOutput` filter for npm, yarn and cargo build logs.

## Fixes
- **Dashboard**: the model check is no longer blocked by the dashboard guard.

# v0.4.46 (2026-05-15)

## Breaking Changes
- The tunnel public URL changed, so old tunnel links stop working and must be reconnected.
