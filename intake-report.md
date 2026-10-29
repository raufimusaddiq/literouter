# Upstream Intake - 2026-10-29

- Ticket: none (owner-requested direct intake).
- Base: LiteRouter `main` at `9c846005ba4dce43c7b136755089e9330af165a9`; previous intake ended at upstream `3a978a631ad65529c06e48ce495092d5bba29f46` (v0.5.111). Upstream now: `1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d` (v0.5.112).
- Decision: **3 keep, 11 drop** across all 14 commits in `3a978a63..1fe586bb`.
- Branch: `intake/20261029-1fe586bb`. The `intake/` prefix keeps the disabled controller's `find_pending_intake` (which resumes `upstream-intake/*` heads) from adopting a manually prepared branch.
- Method: upstream commits read as untrusted text and integrated with `git cherry-pick -x`. No upstream scripts or instructions were executed. The sandboxed intake controller and broker are unchanged.
- Validation: `node --check` on touched modules only. No local installs, builds or tests, per AGENTS.md. GitHub CI and current-head Hermes review gate the merge.

## Commit Decisions

- `1fe586bb` # v0.5.112 - **drop**: upstream release marker; LiteRouter versions independently.
- `85d73bd6` feat(minimax-code): lease auth mode via desktop app named-pipe broker - **drop**: the MiniMax Code executor is not in LiteRouter. The commit also adds an OAuth route, dashboard UI and a `dashboardGuard.js` change (auth surface).
- `d7bb71ce` fix(deepseek): use noble-hashes port for DeepSeek PoW hash - **drop**: `open-sse/lib/deepseek-pow-hash.js` is not in LiteRouter.
- `3b7acf72` fix(docker): bundle lazy runtime deps so OpenCode Free resolves - **drop**: depends on `open-sse/services/lazyRuntime.js`, which LiteRouter does not have. It also changes the production `Dockerfile`.
- `56dbf466` fix(chat): reject SSE errors in non-streaming responses - **keep**: `parseSSEToOpenAIResponse` already returns `{ error }` for an error frame, but the non-streaming handler used that object as a successful body (200, usage saved, success callback fired).
- `8db1f4ae` fix(translator): enforce Gemini protobuf type predicates on schema items and properties - **drop**: the new `enforceTypeConstraints` walks every object value, including `properties` maps. A properties map has no `type`, so it deletes tool parameters literally named `items`, `properties` or `required`. It also strips `properties` from untyped (`anyOf`-style) schemas. Needs a corrected port, not a cherry-pick.
- `f7f6f5ed` feat: add Nace Drex provider to the System One lane - **drop**: new provider (and a hand edit of the generated registry index).
- `ced0cf6e` fix(nvidia): normalize reasoning aliases for NIM - **keep**: NIM treats `reasoning` and `reasoning_content` as one field and rejects assistant history that carries both.
- `a199d777` fix(providers): treat LLM|id|secret as opaque token in bulk-add - **drop**: dashboard bulk-add input convenience, outside the retained core.
- `b1effa03` feat(commandcode): align request headers with official CLI 1.88.0 - **drop**: client-fingerprint churn with no reported failure. It touches `src/app/api/providers/validate/route.js` and the provider baseline.
- `f3e1f716` fix(github): apply Claude 5.5 thinking rules to Copilot's dotted model ids - **drop**: built on upstream's `thinkingOffType` / `forcedToolChoice` capability flags, which LiteRouter never took. LiteRouter's 5.5 rows do not carry them, and `claudeRequestFallback.js` already retries the Sonnet 5.5 `between_tools` 400. Porting the flags is a separate change.
- `3fd925ab` fix(codebuddy): send plugin request/conversation id headers - **keep** (adapted): without the ids, both CodeBuddy gateways reject every call with `400 / 11128 "request illegal"`. Added the missing `randomUUID` import to `executors/default.js`. Upstream's `codebuddy-block-backoff.test.js` changes are not taken: that file belongs to the dropped `3b137aa6` and asserts the request-scoped combo contract LiteRouter rejected on 2026-10-26.
- `acb3c080` feat(codex): add GPT-6.1 Terra - **drop**: catalog expansion.
- `e70ea24d` Fix OpenCode - **drop**: `open-sse/services/lazyRuntime.js` is not in LiteRouter.

## Conflicts

- `CHANGELOG.md` (`3fd925ab`, `ced0cf6e`): kept LiteRouter's side; one consolidated fork entry replaces the upstream hunks.
- `tests/unit/codebuddy-block-backoff.test.js` (`3fd925ab`): modify/delete. The file is absent in LiteRouter and stays absent.
- `open-sse/providers/capabilities.js`, `open-sse/translator/concerns/thinkingUnified.js` (`f3e1f716`): diverged capability table and `applyFormat` signature. The pick was aborted and the commit dropped (see above).
- CI round 1: LiteRouter's golden header snapshot (`tests/translator/golden-url-header.test.js`) now lists the four CodeBuddy id headers. Their per-request UUID values are masked by name as `<ID>`, the same way the test already masks environment-dependent headers.

## Risk

- CodeBuddy requests now carry four random per-request UUID headers. No credential or auth ordering change: hooks still run before `applyAuth`.
- Non-streaming requests whose upstream SSE carries an error frame now fail with the upstream 4xx/5xx status (502 if missing or invalid) instead of returning 200. That lets combo/account fallback see the failure.
- The NVIDIA rule only renames assistant-history `reasoning` to `reasoning_content`, keeping a non-empty canonical value.
