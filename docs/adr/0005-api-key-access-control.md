# ADR-0005: API key storage, fingerprints and access control

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Client API keys authenticate `/v1/*` inference calls. Each key can be unrestricted or restricted to an allow list of combos and models, and the gateway records per-key usage for the dashboard. Three concerns meet here: how keys are generated and stored, how usage data avoids leaking them, and how the allow list is enforced across combos, nested combos, model listings and the Gemini-style `/v1beta` routes. A mistake in any of them either leaks a credential or lets a restricted key call something it should not.

## Decisions

### D1. Restricted keys match resolved identities, are checked once up front, and gate the combo as a whole

A restricted key may call only the combos and models in its allow list. There are no wildcards and no deny mode; matching is exact and case-insensitive on resolved identities. A request routing as a combo is allowed iff the combo name is listed; a request routing to a model is allowed iff its resolved `providerId/model` equals that of a listed entry, so `cx/gpt-5`, `codex/gpt-5` and an alias pointing there are one target, while a raw string that merely looks listed but routes elsewhere (for example `MAIN` when the combo is `Main`) is not. Search/fetch (provider is the model) are allowed iff the provider id is listed or the request is a listed combo. The check runs once on the requested target, before bypass handling, combo expansion and any credential lookup, so a denied request never touches a provider account. An allowed combo grants the members reached through it but not calling a member directly by name. Gating must be on the combo as a whole, not per member, otherwise failover to a permitted member would let a combo through that is not listed. An existing combo with no members resolves to provider null and routes nowhere. Resolved allow sets are cached and valid only for the config version, which combo, alias and key writes bump.

**Where:** `src/sse/services/keyAccess.js`: `getKeyAccessContext`, `getAllowSets`, `enforceKeyAccessResolved`; `src/sse/handlers/chat.js`: `handleChat` access check; `tests/unit/key-access-handlers.test.js`

### D2. Nested combos and capacity adapters only drop models

Access is decided on the outer requested target. Nested combos (a combo member that is itself a combo) inherit that decision and only drop capacity-adapter models the key may not call. Adapter models are appended by the gateway, not chosen by the client, so for a restricted key only adapters it may call directly are kept; the original targets are already gated and always kept. Dropping a model merely shortens the fallback list, so failover is unaffected.

**Where:** `src/sse/services/keyAccess.js`: `filterAdapterModels`; `src/sse/handlers/chat.js`: nested-combo chain expansion

### D3. The key is read from every place the guard reads it

The access context reads the client key from Bearer, `x-api-key`, `x-goog-api-key` and `?key=`, in the same order as the guard in `src/server/guard.js`. The handlers' own `extractApiKey()` reads only the first two, so using it would make a restricted key sent as `x-goog-api-key` look like "no key", which means unrestricted. The context is null only for no key, an unknown key, or an unrestricted key; authentication itself happens elsewhere.

**Where:** `src/sse/services/keyAccess.js`: `extractClientApiKey`, `getKeyAccessContext`

### D4. Every route that bypasses handleChat enforces access itself; listings hide uncallable models

The `/v1beta` models route calls Gemini directly rather than through `handleChat`, so it checks restricted keys in the route before any credential lookup. Model listing and info endpoints filter by the key's allowed set and answer with the same 404 as an unknown model, so a restricted key cannot discover metadata for a model it cannot call. The v1beta list filters on `id` (provider/model), so it derives ids from the Gemini `name` and maps back.

**Where:** `src/app/api/v1beta/models/[...path]/route.js`; `src/app/api/v1beta/models/route.js`; `src/app/api/v1/models/info/route.js`

### D5. Access parsing fails closed; defaults are unrestricted; errors leak nothing

The `restricted` flag has its own INTEGER column, so a corrupt or unparsable allow list can only shrink what a restricted key may call (to nothing) and can never turn it into an unrestricted key. Every key that is new, migrated, or restored from a backup lacking the field is unrestricted unless explicitly switched (`KEY_ACCESS_UNRESTRICTED`). The API rejects over-limit allow lists (`KEY_ACCESS_MAX_ENTRIES`) with 400 instead of truncating, so a declared list is never silently cut. The client-facing 403 message names only what the client itself sent, never the key name or allow list.

**Where:** `src/shared/utils/keyAccess.js`: `keyAccessFromColumns`; `src/shared/constants/keyAccess.js`: `KEY_ACCESS_UNRESTRICTED`, `KEY_ACCESS_MAX_ENTRIES`, `keyAccessDeniedMessage`

### D6. Usage data stores a keyed HMAC fingerprint, never the client key

Usage rows and daily buckets carry a non-reversible fingerprint (`fp_` plus 16 hex chars) produced by `open-sse/utils/keyFingerprint.js`. It is deterministic so one client stays distinguishable from another, and a keyed HMAC so the key cannot be recovered or confirmed without `API_KEY_SECRET`. Client keys are high-entropy random tokens, not passwords, so a fast keyed MAC is the right primitive; the MAC key is stretched once per secret. Issue #136 found plaintext keys in `usageHistory.apiKey` and `usageDaily.byApiKey`: migration 003 rewrites earlier rows (idempotent, fingerprints are left alone) but cannot scrub bytes SQLite already freed, earlier backups or request-log files. The one-time legacy JSON import runs after the versioned migration chain, so `migrate.js` reuses `rewriteUsageDay` to fingerprint imported daily buckets. `apiKeys.key` is the live credential that `validateApiKey` compares verbatim, so it stays plaintext, in legacy import as well.

**Where:** `open-sse/utils/keyFingerprint.js`; `src/lib/db/migrations/003-fingerprint-usage-api-keys.js`: `rewriteUsageDay`; `src/lib/db/migrate.js`; `src/lib/db/repos/usageRepo.js`; `tests/unit/legacy-json-import-fingerprint.test.js`

### D7. Per-key usage is returned keyed by key id

`mapUsageToKeys` joins per-fingerprint aggregates onto keys and keys the response by key id, so neither the raw key nor its fingerprint leaves the server.

**Where:** `src/lib/keyUsage.js`: `mapUsageToKeys`

### D8. Generated keys are random and carry no identifying material

`sk-` plus 24 random bytes (192 bits) base64url; no machineId or other identifying data is embedded. The machineId parameter is ignored and kept only so existing callers keep working. Legacy key formats are parsed only for recognition.

**Where:** `src/shared/utils/apiKey.js`: `generateApiKeyWithMachine`

## Consequences

- Matching on raw request strings instead of resolved identities lets a restricted key reach targets by alias or spelling, or wrongly denies valid ones.
- Checking per member instead of on the combo, or after credential lookup, lets failover bypass the allow list or touches provider accounts for denied requests.
- Reading the key from fewer places than the guard makes restricted keys look unrestricted.
- Direct-to-provider routes added without an access check become a bypass for restricted keys.
- Storing client keys in usage data, or returning fingerprints to the browser, re-opens issue #136.
- Failing open on bad allow-list data silently turns restricted keys into unrestricted ones.
