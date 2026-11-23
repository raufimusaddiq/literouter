# ADR-0026: Model catalog sync, picker and /models listing

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

Model metadata (ids, context windows, output limits, modalities) comes from several places: static registry lists, hand-written capability tables, the daily models.dev sync, Kenari's own public catalog, and live per-account catalogs (Qoder, CommandCode, Cursor, Cline, Kilo, Venice, TokenRouter). These feed the dashboard model picker, the provider page, `GET /v1/models`, and the dashboard model-test probe. The decisions below define who is authoritative, how failures degrade, and how listing and probing avoid misleading users.

## Decisions

### D1. Static registry lists are offline fallbacks; live catalogs win when they resolve

Providers whose catalogs move fast (Kenari weekly, Kilo Code proxying about 334 OpenRouter models, Venice 90+ text models, TokenRouter, Cursor, Cline, Qoder, CommandCode) keep only a seed list in the registry. Unknown ids still route through `passthroughModels`, and a `modelsFetcher` fetches the live list. Without the fetcher the combo picker shows only the hardcoded models and hides dynamic ones. The dashboard and `ModelSelectModal` use `/api/providers/[id]/models` when it resolves and fall back to static rows when the live fetch fails or is empty (an empty array means "nothing live"). Entries collapse by model id because two connections of one provider produce the same picker value (`alias/id`). The provider page lists what the user added; Kenari's live rows only describe models (levels) and never extend the list.

**Where:** `open-sse/providers/registry/kenari.js`, `kilocode.js`, `venice.js`, `tokenrouter.js`; `src/shared/components/ModelSelectModal.js`; `src/app/(dashboard)/dashboard/providers/[id]/page.js`

### D2. Authority order: Kenari for kenari, then models.dev delta, then hand-written tables

For the `kenari` provider, Kenari's published limits and modalities outrank every hand-written table and the models.dev overlay. The catalog file is the source of truth and the parsed copy is dropped when its mtime changes. Every failure (missing file, corrupt JSON, wrong shape, empty upstream list) resolves to "no data", so the existing tables decide and the last good file is kept. Model ids are untrusted input, so lookups use own-property reads only and `fromEntries`, so `constructor` or `__proto__` never resolve to inherited values. Lookups try the exact id first: `glm-4-7-flash:free` is its own entry, and variants are deliberately not stripped to a base id. The Kenari sync is on by default (one small public request a day, no credentials), with `KENARI_CATALOG_SYNC=off` as a kill switch.

**Where:** `open-sse/providers/kenariCatalog.js`; `src/lib/modelCatalog/kenariSync.js`

### D3. models.dev sync stores only deltas, keyed by provider plus model

The daily sync downloads the catalog, keeps only what differs from the hand-written tables, writes it next to the database, and swallows failures on purpose. Limit differences below a threshold are ignored (gateways round 200000 vs 202752). Provider ids map from local to models.dev names at build time, and one upstream name can back several local ids (glm-cn and zhipu are both zhipuai); entries are filed under every local id and the upstream id so custom nodes still resolve. Modalities and limits are keyed by provider plus model, never model id alone: gateways disagree on the same weights, and short ids such as `auto`, `free`, `efficient` are router modes in one catalog and model names in another, so a router mode inherited a stranger's vision. Several upstream ids that normalize to one model (for example `claude-opus-4-thinking:1024`, `:8192`) must not stack modalities. The previous catalog must be detached before snapshotting the hand-written tables; otherwise each delta is relative to the last, agreeing values look like "no change" and the file erases itself over two runs (the reader is restored whatever happened). A file from an older schema is rebuilt even when upstream is unchanged, so a 304 is requested only for a current file. The etag lives in the written file so a restart resumes instead of re-downloading about 4.3 MB. The parse (about 23 ms, daily, idle server) does not warrant a worker thread.

**Where:** `src/lib/modelCatalog/sync.js`

### D4. Model discovery fetches are bounded, shared and never throw

CommandCode publishes the same public catalog its CLI polls (no auth, ETag = catalogVersion, refreshAfterSeconds 900), so both the provider page and `/v1/models` resolve it live. The fetch has a 5s abort, 15 minute success cache, 60s failure backoff, a single in-flight fetch shared by concurrent callers, and returns null on any error so callers fall back to static rows. It goes through the patched global fetch (proxy and keep-alive aware) and sends only the CLI identity headers, never a connection key. `forceRefresh` (a dashboard button) is limited to one forced fetch per minute and failure backoff still applies. A per-1M price above the ceiling is a unit mistake and the row is dropped.

**Where:** `open-sse/services/commandcodeModels.js`: `resolveCommandCodeModels`

### D5. Qoder: cache every model_config, route by exact key, use the right host

Qoder's chat endpoint silently downgrades to a different model when the wrong `model_config` is sent, so the COSY-signed `/algo/api/v2/model/list` catalog is fetched and each `model_config` cached by key. On error the cache stays empty and chat reports "model config not yet fetched, retry shortly". The config is cached even for UI-hidden models (`enable:false`): the chat endpoint still serves them, so `/v1/models` advertises the list the router will actually route, IDE-visible models first. A PAT (`pt-...`) cannot sign COSY requests, so it is exchanged via `openapi.qoder.sh/api/v1/jobToken/exchange` for a job token (`jt-...`); job-token traffic must go to `api2.qoder.sh` because `api3` rejects it with 403 "Login expired". In-flight entries are cleared only if still current, since a later `forceRefresh` may have replaced them. Qoder renames models while keeping the key stable (for example `qmodel_latest`), so refresh upserts every entry so the saved display name follows upstream without duplicate rows, and ids may arrive as `qoder/auto` or `auto` so the prefix is stripped.

**Where:** `open-sse/services/qoderModels.js`; `src/app/(dashboard)/dashboard/providers/[id]/page.js`; `src/shared/utils/providerCustomModels.js`

### D6. /v1/models publishes honest limits, including for combos

A combo can only promise the smallest window among its seats, so combo entries publish the minimum across the chain; they were previously the only entries with no limits, and clients guessed high. Nested combo names are valid seats and are expanded (cycle-guarded), otherwise a no-slash seat is treated as a literal model and publishes the 200k floor. Combo seats use UI aliases while capability overrides and catalog limits are keyed by provider id, so aliases are mapped. The detail route `/v1/models/[...model]` uses a catch-all because provider-prefixed ids contain a slash, and matches the same LLM catalog as the list. A header sent by `fetchCompatibleModelIds` marks cross-instance `/models` fetches; when present the dynamic fetch is skipped to break recursive loops between connected instances.

**Where:** `src/app/api/v1/models/route.js`; `src/app/api/v1/models/[...model]/route.js`

### D7. Model test probe measures time to first token and soft-passes reasoning models

The dashboard probe streams and stops at the first token; waiting for a full generation made the verdict a race against latency, so slow-but-healthy models failed while the upstream call still completed and was billed. The reader is cancelled immediately and the upstream generation stopped, and a reader error on cancel must not mask the verdict. Reasoning models spend budget on chain-of-thought, so a tiny token cap starves them, and `finish_reason: "length"` with empty content but non-empty reasoning counts as a successful connection (issue #3010). A token wins over a terminal `finish_reason` in the same event. A terminal frame with no token anywhere is "no output". An error frame inside an HTTP 200 stream (emitted by the router when a stream aborts after headers) is surfaced verbatim. A timeout means slow, not broken, and is not surfaced as a raw DOMException; probe connection failures carry their own status (504 for slow) while an upstream that answered 502/504 itself keeps the plain 200 body. A non-SSE body is parsed as JSON so the provider's real error survives. The SSE parser handles LF, CRLF and lone CR, holds back a trailing CR (it may be half a CRLF split across chunks), returns each `data:` payload separately, and advances `rest` only past a dispatched event. An unrestricted key is preferred so the test is not refused because the first key is restricted.

**Where:** `src/app/api/models/test/ping.js`; `src/app/api/models/test/route.js`

### D8. Bulk-add must generate names that never collide

The backend upserts apikey connections by name (`connectionsRepo`: `authType === "apikey" && name === data.name`), so a colliding name overwrites an existing key. Bulk-add used to derive `<base> <lineIndex>` blindly and silently replaced earlier keys. The planner gap-fills the smallest free `<base> <n>` against existing connection names and names already assigned in the batch. Each key is validated before saving so bulk-added connections get a real status like single adds.

**Where:** `src/shared/utils/bulkAdd.js`; `src/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js`

### D9. Picker and client-side catalog details

Custom models stay visible in the LLM selector when no `kindFilter` is given, because user-added models may carry typed capabilities (for example `imageToText`) yet remain valid chat/combo targets. Aliases and custom models are stored under the raw `providerId` (for example `openai-compatible-chat-<uuid>/glm-4.7`), so filtering uses the providerId, not the display prefix. Compatible-node transport routes are derived in one place for the API layer, executor and UI; legacy openai-compatible nodes with `apiType: "chat"` keep chat plus translation fallback, while new nodes may advertise several native transports. `models.js` is imported directly rather than through `index.js` to avoid pulling server-side dependencies into the client. `useModelCaps` keeps a null result so a later mount can retry.

**Where:** `src/shared/components/ModelSelectModal.js`; `src/shared/constants/compatibleNodeRoutes.js`; `src/shared/constants/models.js`; `src/shared/hooks/useModelCaps.js`

## Consequences

- Keying capabilities by model id alone, or skipping the detach step in the sync, gives wrong modalities and a self-erasing catalog file.
- Treating a catalog fetch failure or empty list as truth wipes good data instead of falling back.
- Publishing no limits for combos, or ignoring nested combos, makes clients over-send context.
- Probing for a full generation or treating `length`/timeouts as failures marks healthy models as broken and bills for the output.
- Bulk-add without name planning silently overwrites existing API keys.
- Sending a job token to `api3` or a wrong `model_config` makes Qoder fail or silently use another model.
