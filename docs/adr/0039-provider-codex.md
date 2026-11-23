# ADR-0039: Codex executor and tool schemas

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

The Codex provider talks to `https://chatgpt.com/backend-api/codex/responses` with OAuth accounts. Its backend is stricter than the public Responses API: its schema validator is a limited regex engine, it uses account and workspace headers, it does not accept several fields, and refresh-token rotation is dangerous. The executor (`open-sse/executors/codex.js`), the registry entry and a schema sanitizer encode these constraints. Responses-wide rules live in ADR-0017.

## Decisions

### D1. Strip Unicode property escapes from tool schema patterns, on the Codex path only

Codex validates every function tool's `parameters` with a regex engine lacking Unicode property escapes. A `pattern` such as `^(?!__.*__$)[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}"\\./\[\]]{1,200}$` is valid ECMAScript `u`-mode, but Codex answers `400 Invalid schema for function '...': ... is not a 'regex'`. The request is deterministically malformed for this provider, so every account fails identically and a combo pays a full failover before landing somewhere that accepts it (#3922). The strip is scoped (#3667): it is not a global sanitizer, providers that support `\p{...}` keep the constraint, it runs only on the Codex dispatch path and only on `pattern` strings that contain a property escape; everything else passes through byte-identical. Detection counts preceding backslashes (an even count means the backslash is itself escaped, so `\\p{Cc}` is a literal "p"). The walk is copy-on-write, returning the original reference when nothing changed so callers can detect a no-op cheaply, and `properties` is special-cased because its keys are arbitrary property names (possibly "pattern" or "properties") that must never be read as schema keywords.

**Where:** `open-sse/utils/codexToolSchema.js`: `UNICODE_PROPERTY_ESCAPE`, `stripNode`; `open-sse/executors/codex.js`: `patternStats`

### D2. Server-generated item ids and unsupported fields are removed

`rs_`, `fc_`, `resp_` and `msg_` ids cannot be resolved by Codex `/responses` when `store=false` (404), so they are stripped from input (`SERVER_ID_PATTERN`). Fields that Droid CLI sends but Codex does not support (such as `previous_response_id`) are dropped for the same reason: the backend cannot resolve a previous response. A final allowlist filter strips unknown fields that could trigger `routing_unsupported`, reasoning encrypted content is requested because the backend requires it for reasoning models, and system prompts go in `body.input` as `role=developer` to stay in the cacheable prefix. Models that cannot disable reasoning reject "none", so their lowest real level is used.

**Where:** `open-sse/executors/codex.js`: `SERVER_ID_PATTERN`, `convertSystemToDeveloperRole`, reasoning-effort mapping

### D3. Account binding header and per-request state

The account/workspace header is required when several Codex accounts are configured. OAuth import stores the ChatGPT account id as `chatgptAccountId`; older or custom rows may use `workspaceId` or `accountId`. Prefer explicit `workspaceId` but fall back to `chatgptAccountId`, otherwise requests cross-bind to the wrong OpenAI account and surface as `token_invalid` after another account is added. The executor is a singleton and must not hold request state: `transformRequest` runs before `buildHeaders` and stashes the per-request session id in a WeakMap keyed by the transformed body. A request is never replayed after user-visible output, even if that output quotes an error text.

**Where:** `open-sse/executors/codex.js`: `buildHeaders`, `requestContexts`, retry guard (`CODEX_SSE_USER_OUTPUT_PATTERNS`)

### D4. Refresh tokens rotate; refresh lead is kept short

Access tokens live about one hour. A refresh lead of 5 days made the refresh run on every call and rotate the refresh token each time; reusing a rotated token revokes the whole OpenAI session (account logout). `refreshLeadMs` is therefore 10 minutes.

**Where:** `open-sse/providers/registry/codex.js`: `refreshLeadMs`

### D5. Review variants and the auto-review virtual model

Codex auto-generates a `-review` variant for each llm model (review quota family), via `CODEX_REVIEW_SUFFIX` in `withCodexReviewModels()`. `codex-auto-review` (Codex CLI's auto-review model) is not derived from a base model, so it is forwarded verbatim rather than having `-review` stripped, and it must be routed to OAuth Codex; before #1398 it fell through prefix inference to the "openai" default and failed with "No active credentials for provider: openai". Registering it must not push it to the front of the `cx` list, since `getDefaultModel` takes `models[0]`. The gpt-6 review variants were dropped on purpose, so no stray line should re-add one without the `upstreamModelId` wiring.

**Where:** `open-sse/providers/models/helpers.js`: `CODEX_REVIEW_SUFFIX`; `open-sse/providers/registry/codex.js`; `open-sse/services/model.js`; `tests/unit/codex-auto-review-routing.test.js`, `tests/unit/codex-gpt6-models.test.js`

### D6. Version strings are single-sourced and the model catalog is version-gated

The Codex CLI version seen by OpenAI's backend is one constant used for the Version and User-Agent identity headers, bumped when the installed codex CLI is upgraded. The `/codex/models` endpoint gates each entry by `minimal_client_version` against the `client_version` the models route sends; codex CLI's own manifest already requires 0.144.0 for its newest models, so a stale value comes back 200 with those entries quietly missing instead of erroring.

**Where:** `open-sse/providers/registry/codex.js`: `CODEX_CLI_VERSION`; `src/app/api/providers/[id]/models/route.js`: `CODEX_CLIENT_VERSION`

## Consequences

- Leaving `\p{...}` patterns in Codex tool schemas fails the request on every account and wastes a full combo failover; making the strip global would break providers that honor those constraints.
- Keeping server item ids or unsupported fields yields 404 or `routing_unsupported`.
- A missing or wrong workspace header cross-binds requests to the wrong account.
- A long refresh lead rotates the refresh token on every call and can log the account out.
- A stale client version silently hides new models from the catalog; stripping `-review` from `codex-auto-review` sends the wrong model upstream.
