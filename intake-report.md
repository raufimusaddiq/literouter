# Upstream Intake - 2026-11-10

- Ticket: none (owner-requested direct intake).
- Base: LiteRouter `main` at `1d567fcf33b75a9ee598dc6da89613273bd52a30`; previous intake ended at upstream `1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d` (v0.5.112). Upstream now: `1339107e624d1ab150c6a0c2c2ee22caa7e9db2f` (v0.5.116).
- Decision: **8 keep (2 hand-applied, 1 hand-adapted), 21 drop** across all 29 commits in `1fe586bb..1339107e`.
- Branch: `intake/20261110-1339107e`.
- Method: upstream commits read as untrusted text, trial-applied in a throwaway worktree, then integrated with `git cherry-pick -x` or by hand. No upstream scripts or instructions were executed.
- Validation: `node --check` on touched modules only. No local installs, builds or tests, per AGENTS.md. GitHub CI and the current-head Hermes review gate the merge.

## Kept

- `333d249d` fix(kiro): stop splicing unserved regions into service hostnames - **keep** (cherry-pick). An unserved region could build an NXDOMAIN host or send the bearer token to an attacker-chosen origin.
- `7ba1d1ca` fix(gemini): send concrete MIME for remote images - **keep** (cherry-pick). `image/*` is rejected by Antigravity with 400.
- `ef2af4de` fix(translator): preserve all Gemini tool results and follow-up parts - **keep** (cherry-pick). Parallel tool results were dropped after the first.
- `3ca04639` fix(codebuddy-intl): preserve client system prompts - **keep, modified**. Upstream replaces the whole system prompt when any marker matches; LiteRouter narrows the pattern to CLI-identity markers and replaces only the matching lines, so operator instructions survive (Hermes blocker).
- `a3039ab1` fix(dedupe): drop tool_reference blocks naming stripped tools - **keep** (cherry-pick). Strict Claude-compatible upstreams 400 on dangling references.
- `7ef6df56` fix(opencode-go): use current inference endpoint - **keep, hand-applied** (owner decision). Endpoint URLs only; upstream's registry also carries catalog changes from commits LiteRouter dropped (omen-alpha, claude-haiku-5-5, modelsFetcher), which are not taken. Both URL families answered on `/models` when probed, so this is a precaution against the retirement upstream describes.
- `633c82f5` fix(opencode-go): use Claude reasoning on the Messages transport - **keep, hand-applied** (owner decision). The `claude.js` change (keep the DeepSeek thinking placeholder when thinking is `adaptive`) and its unit test. The transport-level `thinkingFormat: "claude-adaptive"` tag is recorded in the registry and baseline, but LiteRouter's `resolveFormat` does not read transport-level formats, so it is inert here. The routing tests that depend on it are not taken.
- `626a0684` fix(thinking): preserve explicit DeepSeek thinking budgets on compat nodes - **keep** (owner decision; conflict resolved by hand: `applyFormat` keeps LiteRouter's `responsesMinimalClamp` argument and gains a trailing `budgetPassthrough`).
- `cff5328b` fix(thinking): preserve intent on OpenAI tool-result turns - **keep** (owner decision; imports merged by hand).
- `963787f7` fix(proxyFetch): stop reusing dead keep-alive sockets - **keep, hand-adapted**. LiteRouter's `proxyFetch.js` predates the upstream dispatcher rework (`736be957`), so the change is re-implemented against it: capped keep-alive Agent for the direct path, a no-keep-alive Agent, one replay on a fresh socket only for errors that prove the socket died (never a bare `fetch failed`), `FETCH_FRESH_RETRY=off` kill switch, executor retries on 502/network errors force a fresh socket, and `stream_options` is dropped on non-streaming OpenAI-compatible requests. Motivation: three kenari `502` responses took 249s in the production logs, the signature upstream describes. TLS curve, happy-eyeballs and undici 8 parts are not taken.

## Added by LiteRouter (not upstream)

- `open-sse/utils/wellFormedJson.js`: request bodies are serialised so a lone UTF-16 surrogate (a split emoji) becomes U+FFFD. Production logs showed 41 kenari `400 invalid JSON: lone leading surrogate in hex escape`.

## Dropped

- `736be957` DPI transport on the claude provider - undici 8 major bump and Vietnamese-ISP specific TLS tuning.
- `a61b5a6f` DashScope Claude cache markers - no DashScope provider in LiteRouter.
- `f0938ea7`, `e3139a43` runtime-dir installs - depend on `lazyRuntime.js`, which LiteRouter does not have.
- `64a23dc2` DeepSeek PoW hash shipping - `deepseek-pow-hash.js` is not in LiteRouter.
- `95dafae3` OpenCode free-tier terminal alias - free tier only.
- Outside the minimal profile: `783c9325`, `a6d3cdbf`, `896ef10c` (codex-image), `b114fa9f` (commandcode), `b9c34543` (sensenova), `8a833631` (antigravity Gemini 4 quota), `93bec5d8` (Jina/Tavily), `a4069daf` (TTS), `69d51c0c` (cli-tools), `9506a59c`, `8650b046` (CLI launcher/tray).
- `eaeb54a6`, `1339107e` upstream release markers.

## Risk

- Direct upstream calls now use a shared undici Agent with a 4s keep-alive TTL (`FETCH_KEEPALIVE_TIMEOUT_MS`), so connections are reopened more often than under Node's default pool.
- The stale-socket replay re-sends a request. It is limited to errors raised before response headers that prove the socket died; ambiguous failures are never replayed.
- The two upstream tests that assumed upstream behaviour were adjusted: `thinking-tool-result-turns` (Opus 5.5 keeps `{type:"adaptive"}`), `qoder-proxy-replay` (direct path now always has the capped agent).
- Rollback: revert the merge; `FETCH_FRESH_RETRY=off` disables only the replay.
