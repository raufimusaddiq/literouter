# LiteRouter v2 Core Architecture Rewrite PRD

Status: Proposed
Target branch: main
Source baseline: audited against main at 25e9df0e02efc3ff47fa1fa616b6fbb55143dac1 (2026-09-23)
Scope: architecture rewrite, migration plan, data-plane/control-plane split, static dashboard replacement
Implementation status: design only; this PR must not change production runtime behavior

## 1. Executive summary

LiteRouter has already removed many of the obvious performance problems inherited from 9Router: process-global account-selection serialization, per-request round-robin persistence, globally serialized Redis commands, synchronous per-request Usage transactions, eager specialized executor allocation, and several unused runtime surfaces.

Those changes materially reduced router overhead and memory, but they do not change the fundamental product shape: the inference gateway, administration APIs, dashboard runtime, persistence adapters, provider logic, telemetry, and compatibility behavior still live inside one Node/Next application derived from 9Router.

The measured baseline shows why the next step should be architectural rather than another cache/mutex pass:

| Measurement | Current LiteRouter baseline |
| --- | ---: |
| Mock-router median latency, warm, n=30 | 13.64 ms |
| Mock-router p95 latency, warm, n=30 | 19.40 ms |
| Kenari median, n=24 | 1580 ms |
| Kenari p95, n=24 | 2062 ms |
| Historical post-burst RSS | 72.3 MiB |
| Production image | about 1.03 GB |

The public-model measurements are dominated by network/upstream latency, so LiteRouter v2 is not justified by a claim that replacing Node alone will make a 1.5-2 second upstream response dramatically faster. The rewrite is justified by four different goals:

1. make the inference path structurally small and predictable;
2. remove the dashboard/runtime coupling that makes the control plane feel heavier than the router itself;
3. create an architecture that is easier to reason about, benchmark, secure, and extend;
4. stop carrying 9Router's internal architecture as LiteRouter's permanent design constraint.

The proposed target is a modular-monolith Go service containing the inference data plane, administration API, configuration compiler, persistence layer, and asynchronous telemetry pipeline, plus a static React dashboard served by Caddy or embedded into the Go binary.

The key invariant is stronger than "memory-first":

> A successful steady-state inference request must not require SQLite, Redis, filesystem I/O, dashboard code, or configuration recomputation on its synchronous path.

Configuration changes are persisted first, compiled into a new immutable runtime snapshot, then atomically swapped into the request-serving process. Native protocol requests use a minimal passthrough path. Telemetry is bounded and asynchronous. SQLite remains the durable system of record for the single-instance deployment. Redis is not required for the v2 single-instance runtime.

This rewrite must be delivered incrementally. The existing Node implementation remains the compatibility oracle until each replacement path passes contract, replay, benchmark, security, and rollback gates.

A 2026-09-23 feature audit against main `25e9df0e02efc3ff47fa1fa616b6fbb55143dac1` expanded the original scope: the compatibility contract includes 95 current API route files, 80 active provider registry entries, 234 unit-regression files, all current public compatibility endpoints, and every visible daily-driver dashboard workflow. Section 5 is the audited feature ledger.

## 2. Problem statement

### 2.1 Current data-plane complexity

The current ingress handler still coordinates many distinct responsibilities:

- request JSON parsing;
- API-key enforcement;
- model normalization;
- combo detection;
- capability detection;
- capacity-adapter selection;
- account selection;
- cooldown and fallback handling;
- provider credential refresh;
- provider-specific quota handling;
- request translation;
- native passthrough;
- specialized executor dispatch;
- optional transforms;
- Usage/request-detail capture;
- error-state persistence.

P0-P2 made many of the underlying reads memory-first, but the conceptual request graph remains broad. A request handler that understands most of the product is difficult to optimize and difficult to verify.

### 2.2 Current control-plane loading model

The dashboard remains a client-heavy Next/React application. Individual pages hydrate first and then fetch multiple resources.

For example, the current overview requests providers, keys, and settings separately. Usage additionally loads providers, provider nodes, period statistics, and a live SSE stream. Request details have their own provider lookup and paginated request-detail calls.

This is valid web application architecture, but it is a poor fit for a small operator console whose primary goal is to show one coherent router state quickly.

The v2 control plane should expose purpose-built read models instead of requiring the browser to reconstruct operational state by joining multiple APIs.

### 2.3 Runtime coupling

The current production image contains the Next application, Node runtime, React server/runtime dependencies, dashboard dependencies, request routing code, database adapters, CLI-related compatibility surfaces, and provider machinery.

This creates several forms of coupling:

- UI framework lifecycle shares a process with inference;
- production image size is dominated by a product surface unrelated to the hot path;
- custom HTTP bootstrap behavior exists partly to work around framework/runtime behavior;
- request, UI, telemetry, and persistence changes can affect one deployable unit;
- architectural cleanup is constrained by compatibility with the inherited module graph.

### 2.4 Cache architecture is improved but fragmented

The current implementation correctly moved many reads into process-local caches. However, provider connections, combos, provider nodes, aliases, proxy pools, settings, and other state are still represented by multiple repository-specific cache mechanisms.

The v2 design replaces repository-local runtime caching with one compiled immutable runtime snapshot. Persistence repositories become write/read-durable-state concerns; the router reads a single coherent runtime view.

## 3. Goals

### 3.1 Data-plane goals

LiteRouter v2 must:

- serve OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, and System One/Jev ingress;
- preserve native upstream passthrough whenever source and destination protocol are compatible;
- translate only when protocol or provider requirements make translation necessary;
- preserve provider and account routing behavior;
- preserve Combo behavior and fallback semantics;
- preserve quota/cooldown-aware account selection;
- keep the successful hot path independent from durable persistence;
- keep per-request allocation and parsing bounded;
- stream upstream output as early as safely possible;
- avoid buffering full model responses unless a translation or feature explicitly requires it;
- provide cancellation propagation from client disconnect to upstream request;
- reuse upstream HTTP transports and connection pools.

### 3.2 Control-plane goals

The v2 dashboard must:

- load useful operational state with one initial overview request;
- avoid Next server runtime in production;
- provide typed query caching and explicit invalidation;
- receive live router events through one event channel;
- preserve provider/account, Combo, endpoint/key, Usage, Quota, token-saver, System One, profile/settings, and retained console/request-detail workflows;
- make slow or unavailable secondary panels non-blocking to the rest of a page;
- remain usable when live-event streaming is disconnected by falling back to query refresh.

### 3.3 Operational goals

LiteRouter v2 must:

- remain one deployable service for the normal production topology;
- keep SQLite as the durable source of truth for the current single-instance use case;
- require no Redis service for single-instance operation;
- provide deterministic startup and health/readiness behavior;
- support an atomic rollback to the existing Node release during migration;
- preserve the current production volume until the migration is proven reversible;
- produce an immutable production image from main.

### 3.4 Maintainability goals

The rewrite must:

- establish LiteRouter-owned interfaces rather than porting 9Router module boundaries one-for-one;
- make routing policy independent from provider transport implementation;
- make provider protocol handling testable without the UI or SQLite;
- make config compilation testable from deterministic fixtures;
- make provider-specific behavior isolated and discoverable;
- reduce side-effect imports and process-global initialization;
- make security boundaries explicit at ingress and outbound-network layers.

## 4. Non-goals

The initial v2 release does not attempt to:

- introduce microservices;
- introduce Kubernetes;
- provide high availability or active-active SQLite writers;
- replace SQLite with Postgres solely for the rewrite;
- use Redis as a mandatory request-path dependency;
- change existing public model names without an explicit migration;
- redesign provider product behavior while simultaneously porting it;
- remove a currently retained provider merely because its implementation is inconvenient;
- promise lower public-model p95 when the upstream dominates latency;
- preserve internal JavaScript module APIs;
- preserve 9Router package layout or internal naming;
- ship every future multi-replica capability in the first v2 release.

## 5. Product compatibility invariants

The following are release-blocking until explicitly superseded by another approved product decision.

This section was audited against current main at `25e9df0e02efc3ff47fa1fa616b6fbb55143dac1` on 2026-09-23. The repository is still changing quickly; Phase 0 must generate a machine-readable parity manifest from the then-current main and CI must fail on unclassified drift.

### 5.1 Public client contracts

V2 must preserve the currently exposed client-facing behavior, not only the three headline LLM endpoints.

Required public routes and compatibility aliases include:

- `POST /v1/chat/completions`;
- `POST /v1/responses`;
- `POST /v1/responses/compact`, including the current compact-mode semantics;
- `POST /v1/messages`;
- `POST /v1/messages/count_tokens`, including the current response shape;
- `POST /v1/systemone`;
- `POST /v1/api/chat`, including Ollama-compatible response transformation;
- `GET /v1` and `GET /v1/models`;
- `GET /v1/models/{provider}/{model}` catch-all lookup;
- `GET /v1/models/info`;
- `GET /v1beta/models`;
- Gemini-compatible `POST /v1beta/models/{model}:generateContent`;
- Gemini-compatible `POST /v1beta/models/{model}:streamGenerateContent`;
- current rewrite aliases `/responses` and `/codex/:path*`;
- current double-prefix compatibility for `/v1/v1` where clients rely on it;
- CORS/preflight behavior required by the current clients.

The current Gemini-compatible route has a special native Gemini TTS path. V2 must preserve the currently routable native TTS behavior, authentication forms, cancellation, timeout/error mapping, account fallback, safe header forwarding, and Gemini response/stream shape before that route family can move.

The public contract also includes:

- current model identifiers, provider prefixes, aliases, and custom models;
- model-list filtering and disabled-model behavior;
- live model resolution where current providers perform it;
- compatible-provider model discovery and recursion protection;
- API-key behavior across Bearer, Anthropic `x-api-key`, and currently supported Gemini key forms;
- streaming terminal semantics, including exactly-once terminal behavior where the current tests require it;
- non-streaming behavior;
- client disconnect/cancellation behavior;
- required response headers;
- current status/error shapes where clients depend on them;
- request-body limits at least as permissive as the current production path for long contexts/base64 images.

A route may change internal implementation but may not silently disappear because it was not listed in the original v2 proposal.

### 5.2 Transport and protocol behavior

Preserve all currently exercised transport behavior:

- OpenAI Chat Completions;
- OpenAI Responses;
- Anthropic Messages;
- Gemini GenerateContent and Gemini SSE compatibility;
- Ollama-compatible chat transformation;
- System One/Jev native JSON forwarding;
- native passthrough when source and target are compatible;
- translation only when required;
- Responses custom tools, parallel tool calls, multi-turn state, compact mode, terminal events, and abort handling;
- Anthropic tool-use/tool-result ordering and count-token compatibility;
- reasoning/thinking fields and provider-specific effort/level mappings;
- multimodal/file block routing that current main supports;
- continuity/modality stripping rules already covered by current tests;
- provider-specific wire formats and terminal integrity.

Unknown forward-compatible fields on a native path must remain preserved wherever the current path preserves them.

### 5.3 Routing behavior

Preserve:

- multi-provider routing;
- multiple accounts per provider;
- fill-first behavior;
- global round-robin and sticky-round-robin limits;
- per-provider strategy overrides and per-provider sticky limits;
- preferred/pinned connection behavior where currently used;
- account exclusion during retries;
- bounded account fallback;
- model-level cooldown/lock behavior;
- manual model-cooldown visibility and clearing;
- provider-specific precise reset times;
- GitHub monthly usage-limit reset behavior;
- Antigravity per-model live quota blocking/reset behavior;
- quota-aware account/provider selection;
- no-auth/free-provider virtual connections;
- no-auth/free-provider proxy-pool selection and rotation where configured;
- connection priorities/reordering;
- Combo ordered fallback;
- Combo round-robin/sticky behavior;
- Combo per-combo strategy override through `comboStrategies`, retaining fallback and round-robin behavior used by LiteRouter;
- per-provider routing overrides through `providerStrategies`, including provider-specific fallback strategy and sticky round-robin limits;
- Fusion/panel+judge is not part of the v2 retained product contract unless reintroduced by a later explicit product decision;
- capability/capacity-adapter routing is not part of the v2 retained product contract; multimodal blocks may still pass through normal LLM chat protocols when the selected model/provider supports them.
- Generic Provider/custom provider nodes;
- proxy-pool binding per connection and provider-level pool rotation;
- outbound global proxy + no-proxy behavior.

### 5.4 Explicitly non-retained routing surfaces

LiteRouter v2 is an LLM chat router plus System One. It is not a general media router.

The following current-main routing surfaces are explicitly **not** part of the v2 product contract:

- vision capacity-adapter pools;
- audio-input capacity-adapter pools;
- stored pdf/video capacity-adapter state;
- automatic model substitution based on media capability;
- history trimming that exists only to support a capacity-adapter substitution;
- Fusion/panel+judge execution.

This does **not** prohibit normal multimodal content inside retained LLM protocols. If an OpenAI Responses, Chat Completions, Anthropic Messages, or other retained LLM request contains an image/audio/file block that the selected upstream model already supports, LiteRouter may preserve and forward that block according to the protocol contract.

The distinction is:

~~~text
retained: selected LLM model receives its supported chat/multimodal payload
removed:  LiteRouter dynamically reroutes to a separate capability/media pool
~~~

Existing databases may still contain `capacityAdapter` or Fusion-related settings from current main. Migration must tolerate those keys without manual database editing, but v2 does not activate those removed behaviors. Unknown/deprecated JSON settings should be preserved or migrated safely so rollback to the retained Node image remains possible during the rollback window.

### 5.5 Provider catalog contract

The active provider registry is a compatibility contract.

At the audited main SHA there are 80 active registry entries:

`alicode-intl`, `alicode`, `anthropic`, `antigravity`, `azure`, `blackbox`, `byteplus`, `cerebras`, `chutes`, `claude`, `cline`, `clinepass`, `cloudflare-ai`, `codebuddy-cn`, `codex`, `cohere`, `commandcode`, `cursor`, `deepseek`, `featherless`, `fireworks`, `gemini-cli`, `gemini`, `github`, `gitlab`, `glm-cn`, `glm`, `grok-cli`, `grok-web`, `groq`, `hyperbolic`, `iflow`, `kilocode`, `kimchi`, `kimi`, `kiro`, `mimo-free`, `minimax-cn`, `minimax`, `mistral`, `mmf`, `nebius`, `nvidia`, `ollama-local`, `ollama`, `openai`, `opencode-go`, `opencode`, `openrouter`, `perplexity-web`, `perplexity`, `perplexity-agent`, `qoder`, `siliconflow`, `together`, `venice`, `vercel-ai-gateway`, `vertex-partner`, `vertex`, `volcengine-ark`, `xai`, `xiaomi-mimo`, `xiaomi-tokenplan`, `alims-intl`, `codebuddy-intl`, `zed`, `api-airforce`, `baidu`, `bazaarlink`, `bluesminds`, `kilo-gateway`, `llm7`, `sambanova`, `tencent`, `morph`, `poolside`, `tokenrouter`, `alitp-intl`, `kenari`, and `typesafe`.

Every active entry must receive an explicit v2 disposition in the parity manifest:

- `preserve-native`;
- `preserve-via-shared-protocol-adapter`;
- `replace-with-equivalent`; or
- `sunset-by-explicit-product-decision`.

No active provider may disappear merely because its executor is difficult to port.

The currently intentionally hidden registry entries `trae`, `devin-cli`, and `windsurf` remain hidden unless a separate product decision changes their status. Existing tests for hidden/internal adapters may remain as source-regression coverage but do not automatically make the provider user-visible.

### 5.6 Provider connection/authentication workflows

Preserve the provider-management behavior used by current main, including where applicable:

- OAuth authorize/callback/exchange;
- API-key connections;
- access-token connections;
- no-auth/free connections;
- web-cookie/session flows;
- provider-specific PAT/cookie/API-key helpers;
- on-demand token refresh;
- configured background token refresh when enabled, even though the current production compose disables it;
- provider model discovery;
- suggested-model discovery;
- provider validation/test;
- batch tests;
- connection health/status;
- provider-specific quota reads;
- live model catalogs;
- model test/ping;
- provider thinking controls;
- quota auto-ping where supported;
- proxy assignment and testing.

Current import helpers are also compatibility surfaces, including:

- Codex token import and bulk import;
- Cursor import and auto-import;
- GitLab PAT;
- Grok CLI bulk import;
- iFlow cookie;
- Kiro API-key, import, auto-import, CLI-proxy import, and social auth/exchange;
- Xiaomi Mimo API-key and auto-import;
- the generic `/oauth/{provider}/{action}` flow.

Credential update behavior must preserve current identity/dedup semantics. In particular, the v2 storage layer must not collapse distinct OAuth identities that current main keeps separate, and must preserve Codex multi-account/workspace identity behavior.

Refresh-token rotation is correctness-critical. A refresh operation that produces new credentials must update runtime state and durable state atomically enough that a restart does not revive a consumed/stale refresh token.

### 5.7 Models, aliases, pricing, and availability

Preserve:

- model aliases;
- custom models and capability metadata;
- disabled models;
- pricing overrides;
- current provider/model catalog;
- manual catalog sync behavior;
- model availability/cooldown reporting and clearing;
- model test/ping;
- provider-prefix customization;
- compatible-provider model discovery;
- live-provider model resolution for the providers that currently implement it;
- model capabilities, context windows, options, and service-kind metadata exposed to clients/UI;
- recursion prevention when one LiteRouter-compatible endpoint discovers models from another.

Model catalog updates landing on main during the migration must be caught by the parity-manifest drift gate rather than silently missing from Go.

### 5.8 Retained request transforms and cache behavior

Retain:

- RTK/token saver and its current supported request shapes/safety behavior;
- Caveman is hard-retained, including `cavemanEnabled`, `cavemanLevel`, and current locale-dependent level behavior;
- Ponytail is hard-retained, including `ponytailEnabled` and `ponytailLevel`;
- Headroom is hard-retained, including `headroomEnabled`, URL/timeout settings, managed start/stop/restart/status, extras, compression settings, and proxy behavior;
- PXPIPE is hard-retained for the current daily-driver deployment, including `pxpipeEnabled`, thresholds/timeouts, runtime management, health/log/stats APIs, and current request-detail diagnostics. Its UI exposure may remain intentionally limited, but the runtime feature is not optional for v2;
- provider thinking controls;
- system-prompt injection behavior;
- request bypass/warmup behavior where currently reachable;
- source-format detection;
- provider-specific thought-signature/session/cloaking behavior;
- image prefetch/hardening behavior used by current providers;
- prompt-cache anchoring and cached-token accounting specified in section 19.4.

Transforms must retain their current fail-open/fail-safe semantics where a transform failure is not supposed to fail the LLM request.

### 5.9 Dashboard/operator workflows

The static dashboard replacement must preserve the currently visible operator surfaces:

1. Overview;
2. Endpoint & Key;
3. Providers;
4. Combo & Vision Adapter;
5. System One;
6. Usage;
7. Quota Tracker;
8. Token Saver;
9. Console Log;
10. Settings/Profile.

It must also preserve reachable supporting workflows, including pricing settings.

Specific daily-driver behavior to preserve includes:

- API-key create/read/mask/copy/pause/resume/delete;
- first-run default-key provisioning when no key exists;
- `requireApiKey`;
- dashboard `requireLogin`;
- password setup/change/login/logout/reset behavior;
- endpoint security warnings;
- light/dark/system theme;
- locale selection/persistence;
- global and per-provider routing strategy controls;
- global and per-combo routing strategy controls;
- proxy configuration, no-proxy configuration, and proxy testing;
- provider CRUD/reorder/test/model discovery;
- aliases/custom models/disabled models;
- proxy-pool CRUD/test and per-connection/bulk assignment;
- Combo CRUD/reorder/strategy/judge configuration;
- capability-adapter configuration;
- System One request workbench;
- Usage overview/charts/tables;
- Usage live updates;
- request log view;
- request-detail filters/pagination/drawer;
- request detail client request, translated provider request, raw provider response, token/cache fields, and transform diagnostics;
- provider topology/activity;
- Quota provider/account limits, reset windows, and health;
- quota auto-ping controls where currently exposed;
- Codex reset-credit behavior;
- Console Log retrieval, streaming, and clearing;
- observability enablement and limits;
- database export/import;
- settings required by Headroom and PXPIPE compatibility.

The v2 visual design may change, but these workflows cannot be dropped accidentally.

### 5.10 Current control/API surface

Phase 0 must inventory every current `src/app/api/**/route.js` file. At the audited main SHA there are 95 API route files.

The inventory must include at least these categories:

- auth/session;
- keys;
- settings and database backup/restore;
- locale/tags;
- combos;
- providers and provider tests;
- OAuth/import helpers;
- provider nodes;
- proxy pools;
- models, aliases, custom/disabled models, availability, tests, catalog sync;
- pricing;
- Usage/history/stats/chart/request logs/request details/provider breakdown/live stream;
- quota/reset-credit behavior;
- console logs and console-log stream;
- health;
- Headroom management/proxy;
- PXPIPE management/health/logs/stats;
- all public `v1` and `v1beta` routes.

The new control API may consolidate or rename private/admin endpoints, but the old dashboard and any retained CLI consumer must have a compatibility path until its caller has migrated.

### 5.11 Durable state and settings

The current SQLite schema version at the audited baseline is 2. The migration must preserve all current durable tables and their data:

- `_meta`;
- `settings`;
- `providerConnections`;
- `providerNodes`;
- `proxyPools`;
- `apiKeys`;
- `combos`;
- `kv`;
- `usageHistory`;
- `usageDaily`;
- `requestDetails`.

This includes data stored in JSON columns and KV scopes, not only typed columns.

Durable behavior includes:

- provider credentials and provider-specific data;
- provider priority and active state;
- model locks/cooldowns and error/backoff state when currently restart-durable;
- aliases;
- custom/disabled models;
- pricing;
- Usage history/daily aggregates;
- request details;
- settings;
- API keys;
- proxy pools;
- Combo definitions.

The settings parity inventory must include current defaults and dynamically stored settings, including `providerStrategies`, `comboStrategies`, global fallback/sticky settings, quota visibility/auto-ping, login/API-key policy, observability, outbound proxy/no-proxy, RTK, Headroom, Caveman, Ponytail, PXPIPE, provider thinking, and other active settings found by the Phase 0 manifest. Legacy `capacityAdapter` and Fusion-only settings are tolerated for migration/rollback compatibility but are not activated by v2.

Database backup/export and restore/import are daily-driver features and receive dedicated migration tests.

No production migration may require manually editing SQLite rows.

### 5.12 Observability contract

Preserve:

- Usage history and daily aggregation;
- request counts;
- prompt/completion/cached/cache-creation token visibility where reported;
- cost/pricing calculations;
- provider/model/account/API-key/endpoint breakdowns used today;
- recent/live request state;
- request logs;
- request details;
- request-detail redaction;
- provider topology/activity;
- quota/provider limit cards;
- console logs;
- live Usage/console event streams;
- bounded retention/settings;
- graceful drain on shutdown.

Observability being disabled must continue to reduce detailed capture according to current settings without breaking critical Usage/accounting behavior.

### 5.13 Security and network behavior

The rewrite must preserve or strengthen:

- remote API-key enforcement;
- dashboard authentication;
- local/operator trust boundaries;
- protection from spoofed forwarding headers;
- trusted reverse-proxy peer handling;
- current internal-peer proof semantics or a simpler equally strong replacement;
- outbound SSRF protection for user-configurable provider URLs;
- metadata/private/link-local blocking rules where applicable;
- redirect revalidation;
- credential redaction;
- request-log header sanitization;
- constant-time or equivalently safe API-key comparison;
- secrets staying server-side;
- provider validation using the same outbound-network policy as inference;
- image-fetch hardening;
- safe forwarding/removal of content-encoding/content-length/hop-by-hop headers where current native routes require it.

The current custom server also handles h2c upgrade traffic from clients such as JBR 25 by replaying it through the HTTP/1.1 handler. V2 must either support the relevant client transport natively or provide a verified compatibility path before Node is removed.

### 5.14 Auxiliary repository surfaces

The initial v2 production rewrite is a server/control-plane migration, not a forced deletion of repository auxiliary tooling.

The existing CLI/tray/package sources may remain on the repository during migration. They do not have to be rewritten into Go in the first production cutover, but:

- their builds must not be broken unintentionally;
- any server APIs they still consume must remain compatible until those callers are migrated or explicitly deprecated;
- hidden/media-only CLI commands are not automatically new v2 server product requirements.

### 5.15 Regression-suite parity manifest

At the audited main SHA the repository has 234 `tests/unit/*.test.js` files.

Phase 0 must generate a test-parity ledger. Every existing regression test gets exactly one disposition:

- `ported` — equivalent Go/UI test exists;
- `differential` — behavior is proven by Node-vs-Go fixture;
- `retained-node` — Node-only surface still exists during migration;
- `not-applicable` — implementation-only test whose external invariant is covered elsewhere, with written rationale;
- `sunset` — behavior intentionally removed by an explicit product decision.

A v2 phase cannot delete the Node implementation that owns a behavior while tests for that behavior remain unclassified.

### 5.16 Main-drift rule

The parity manifest records the exact source main SHA.

Before every cutover PR and before Node removal:

1. compare current main against the manifest SHA;
2. classify any new/changed public route, provider, setting, durable field, dashboard workflow, or relevant regression test;
3. update fixtures/implementation as required;
4. advance the manifest SHA only after review.

This prevents a long-running rewrite from shipping with the feature set that existed only when the project started.

## 6. Target architecture

### 6.1 Logical architecture

~~~text
                         Caddy / edge
                              |
            +-----------------+-----------------+
            |                                   |
       inference paths                    dashboard/static
            |                                   |
            v                                   v
  +-----------------------+            +------------------+
  | LiteRouter Go service |            | static React UI  |
  |                       |<---------->| admin API/events |
  |  ingress              |            +------------------+
  |  router               |
  |  runtime snapshot     |
  |  provider adapters    |
  |  protocol adapters    |
  |  transport pools      |
  |  telemetry            |
  |  admin/control API    |
  |  config compiler      |
  +-----------+-----------+
              |
              v
        +-----------+
        |  SQLite   |
        | durable   |
        |   state   |
        +-----------+
~~~

Normal production should remain one Go process plus Caddy. The static dashboard may be served by Caddy from built assets or embedded into the Go binary. The implementation may choose either after image-size and cache-header comparison.

### 6.2 Repository shape

Proposed target layout:

~~~text
cmd/
  literouter/
    main.go

internal/
  ingress/
    openai_chat.go
    openai_responses.go
    anthropic_messages.go
    systemone.go
    middleware.go

  runtime/
    snapshot.go
    compiler.go
    manager.go
    version.go

  routing/
    resolver.go
    plan.go
    combo.go
    accounts.go
    cooldown.go
    capability.go

  protocol/
    canonical/
    openai/
    anthropic/
    systemone/

  providers/
    registry.go
    generic/
    codex/
    github/
    vertex/
    antigravity/
    kiro/
    opencode/
    ...

  transport/
    client_pool.go
    proxy.go
    stream.go
    ssrf.go

  telemetry/
    events.go
    queue.go
    writer.go
    live.go

  control/
    overview.go
    providers.go
    combos.go
    usage.go
    quota.go
    settings.go
    keys.go
    events.go

  store/
    sqlite.go
    migrations/
    settings.go
    providers.go
    combos.go
    usage.go
    request_details.go

  auth/
    api_key.go
    dashboard.go
    trusted_proxy.go

ui/
  src/
  public/
  package.json
  vite.config.*

compat/
  fixtures/
  replay/
  contracts/

bench/
  mock_upstream/
  router_bench/

docs/
  literouter-v2-architecture-prd.md
~~~

This is a target decomposition, not a requirement that every provider receive its own package on the first commit. The rule is that package boundaries follow responsibility, not inherited 9Router directories.

## 7. Core runtime model

### 7.1 Immutable runtime snapshot

All request-serving configuration is compiled into one immutable structure.

Conceptual model:

~~~text
RuntimeSnapshot
  version
  settings
  api-key index
  model index
  alias index
  provider index
  provider-node index
  connection index
  combo index
  proxy-pool index
  pricing index required for telemetry
  precompiled route metadata
~~~

The serving process holds the active snapshot through an atomic pointer/reference.

Request path:

~~~text
snapshot = runtime.Load()
~~~

No lock is required to read the active snapshot.

A configuration mutation follows:

~~~text
admin request
  -> validate
  -> SQLite transaction
  -> read committed durable state needed for compilation
  -> compile new immutable snapshot
  -> validate snapshot
  -> atomic swap
  -> emit config.changed
~~~

If compilation fails after the SQLite transaction, the control API must not silently continue serving stale configuration indefinitely. The implementation must either:

1. compile before commit when validation can be performed without committing; or
2. commit, attempt compile, and return the service to a known state by reloading/compiling the committed database before acknowledging success.

The selected transaction/compile protocol must be documented and tested.

### 7.2 Runtime state vs durable configuration

Not all state belongs in RuntimeSnapshot.

Durable configuration:

- provider credentials;
- provider enabled/disabled state;
- account priority;
- model aliases;
- Combo definitions;
- API keys;
- proxy configuration;
- settings.

Ephemeral runtime state:

- round-robin cursor;
- sticky-use counter;
- in-flight request count;
- transient quota cache;
- circuit-breaker/short cooldown state that does not need restart durability;
- live health;
- transport pool state.

Explicitly durable operational state, if required for compatibility:

- provider/account locks that must survive restart;
- exact provider reset-at state where the current contract expects it.

The implementation must document each state field's ownership rather than storing mixed configuration and request-serving cursors in one row.

### 7.3 Configuration lifecycle and Redis-free single-instance flow

For the normal LiteRouter v2 deployment, Redis is not part of configuration serving.

The configuration lifecycle is:

~~~text
process start
  -> open SQLite
  -> run/verify schema migrations
  -> load durable configuration
  -> compile RuntimeSnapshot
  -> atomically publish snapshot
  -> mark readiness healthy
~~~

Until the initial RuntimeSnapshot has compiled successfully, readiness must return unhealthy and inference must not accept normal production traffic.

Steady-state inference reads configuration only from process memory:

~~~text
request
  -> runtime.Load()
  -> RoutePlan lookup
  -> account/runtime-state selection
  -> upstream
~~~

No Redis lookup, Redis version check, SQLite read, or filesystem read is permitted on the successful steady-state configuration path.

Configuration mutations follow this model:

~~~text
admin mutation
  -> validate
  -> persist durable change in SQLite
  -> compile a complete coherent RuntimeSnapshot
  -> atomically swap active snapshot
  -> publish config.changed
  -> acknowledge active snapshot version
~~~

The implementation must guarantee that an acknowledged mutation corresponds to a known active snapshot version. A mutation must not report success merely because SQLite committed if the new configuration could not be activated.

Requests already in flight retain the snapshot reference with which they started. New requests observe the newly published snapshot. This prevents a request from seeing a partially mixed provider/account/combo/settings state.

### 7.4 Runtime state ownership

RuntimeSnapshot contains immutable request-serving configuration.

Examples:

- settings required by routing;
- API-key index;
- model and alias indexes;
- provider metadata;
- provider-node metadata;
- connection/account configuration;
- Combo definitions and compiled graphs;
- proxy-pool configuration;
- pricing/configuration needed by telemetry;
- precompiled route metadata.

Mutable operational state lives separately in process memory.

Examples:

- provider/account round-robin cursors;
- sticky-use counters;
- active request counts;
- circuit-breaker state;
- transient cooldown state;
- transport-pool state;
- live provider health;
- short-lived quota observations.

Request-serving cursors must never be persisted synchronously merely to advance routing state.

For operational state that must survive restart, such as a provider-specific lock/reset timestamp whose compatibility contract requires restart durability, the preferred flow is:

~~~text
provider response changes state
  -> update in-memory runtime state immediately
  -> request path observes new state immediately
  -> enqueue durable state update
  -> SQLite persists asynchronously
~~~

If a specific state transition cannot safely be acknowledged without durable persistence, that exception must be documented explicitly and kept off the normal successful inference path.

### 7.5 Redis reintroduction boundary

Redis may be reintroduced only when LiteRouter runs multiple independently serving replicas that require cross-process invalidation or coordination.

A future multi-replica flow may look like:

~~~text
Replica A
  -> SQLite/config authority mutation
  -> local snapshot swap
  -> publish config version/invalidation

Redis or another coordination bus
  -> Replica B observes version
  -> reload/compile
  -> local snapshot swap
~~~

Redis is therefore an optional coordination layer, not a source of truth and not an inference-path cache.

The v2 single-instance production definition of done requires that LiteRouter starts, serves configuration, routes inference, records Usage, and operates the dashboard without Redis.

### 7.6 Configuration mutation transaction protocol

For a single v2 process, configuration mutation is serialized by a **control-plane mutation lock**. This lock is never acquired by inference reads.

The required mutation protocol is:

~~~text
control mutation lock
  -> load current logical config state
  -> apply requested mutation in memory
  -> validate full candidate state
  -> compile complete candidate RuntimeSnapshot
  -> begin SQLite transaction
  -> persist mutation
  -> bump monotonic config_revision in _meta
  -> commit
  -> atomic publish of already-compiled snapshot
  -> emit config.changed(snapshotVersion/configRevision)
  -> respond success
  -> release mutation lock
~~~

Rules:

- all validation and snapshot compilation that can fail must happen before the durable commit;
- if SQLite commit fails, discard the candidate snapshot and keep the old active snapshot;
- after commit, the atomic pointer publication itself must not depend on fallible external work;
- the API does not return success until the committed revision is the active snapshot;
- if the process crashes after commit but before publication, startup recompiles the committed database before readiness, so the durable database still wins;
- application-generated IDs/timestamps needed by the snapshot are chosen before commit so the persisted and compiled states are identical;
- direct external edits to the live SQLite file while LiteRouter is running are unsupported.

The `config_revision` value is also useful for diagnostics, backup metadata, and future multi-replica invalidation. It is not polled by the inference hot path.

### 7.7 Database import/restore protocol

Database restore is not an ordinary settings mutation.

A restore must:

1. authenticate the operator;
2. write/parse the incoming backup into a temporary location;
3. verify file/schema integrity;
4. run required migrations against the temporary candidate, not the live database;
5. compile a RuntimeSnapshot from the candidate database;
6. stop accepting control mutations;
7. quiesce or drain telemetry writes;
8. take a rollback copy/checkpoint of the current live database;
9. replace/import the candidate using an atomic or transactionally equivalent procedure;
10. publish the already-validated snapshot;
11. reopen telemetry;
12. return success only after the new database and snapshot are active.

On any failure before activation, the old database and old snapshot remain active. On activation failure, restore the rollback copy before accepting traffic.

## 8. Route compilation

### 8.1 Why compile

The current router performs many logically static decisions during requests. V2 should pre-resolve as much as possible when configuration changes.

A RoutePlan may contain:

~~~text
RoutePlan
  public model key
  source protocol policy
  target provider/model
  provider adapter
  candidate accounts
  account strategy
  proxy policy
  capability metadata
  translation policy
  transforms
  timeout policy
  fallback chain
  telemetry labels
~~~

Dynamic decisions remain dynamic only when they depend on request content or live runtime state.

Examples:

- account round-robin selection is dynamic;
- whether the body contains an image is request-dependent;
- provider/model mapping is normally compile-time;
- alias lookup is compile-time;
- Combo membership is compile-time;
- provider-node resolution is compile-time;
- static proxy binding is compile-time;
- current cooldown eligibility is runtime state.

### 8.2 Model resolution flow

~~~text
incoming model
  -> normalize context marker
  -> direct route lookup
  -> alias resolution
  -> combo lookup
  -> custom provider-node lookup
  -> capability evaluation
  -> execution plan
~~~

The compiler should reject ambiguous model names at configuration mutation time where possible rather than discovering ambiguity during inference.

## 9. Request execution flows

### 9.1 Native fast path

This is the preferred path.

~~~text
client
  -> ingress auth
  -> decode minimal routing metadata
  -> runtime snapshot lookup
  -> select eligible account
  -> build upstream request
  -> upstream
  -> copy native response stream
  -> client

side channel:
  request event -> telemetry queue
~~~

Requirements:

- do not parse individual stream events when the upstream protocol is already compatible;
- do not buffer the full response;
- propagate client cancellation to the upstream context;
- preserve required upstream headers;
- strip/redact unsafe headers;
- record TTFT without delaying first-byte forwarding;
- emit telemetry after/beside forwarding, not before forwarding.

The target implementation should use a reusable buffer for stream copying where practical.

### 9.2 Translation path

~~~text
client protocol
  -> decode canonical request
  -> route/account selection
  -> encode target protocol
  -> upstream
  -> incremental decode target stream
  -> incremental encode client protocol
  -> client
~~~

Only translation paths pay structured stream parse/encode cost.

Translation tests must include:

- text deltas;
- reasoning/thinking fields where supported;
- tool calls;
- tool-call arguments arriving incrementally;
- usage events;
- finish reasons;
- error events;
- empty/heartbeat events;
- terminal markers.

### 9.3 Account fallback flow

~~~text
plan
  -> select eligible account
  -> execute
       |
       +-- success -> clear compatible transient breaker state -> return
       |
       +-- retryable provider/account failure
             -> classify
             -> update runtime cooldown state
             -> persist only state that must survive restart
             -> exclude attempted account
             -> select next eligible account
             -> repeat until bounded attempt cap
~~~

The attempt cap remains explicit.

No failed request may spin forever because quota refresh or provider state changes reintroduce a previously attempted account.

### 9.4 Combo flow

Compile Combo definitions into an execution graph.

Fallback strategy:

~~~text
combo
  -> model A
       -> account fallback
       -> success OR model unavailable
  -> model B
       -> ...
~~~

Round-robin strategy:

~~~text
combo-local runtime cursor
  -> selected model
  -> normal account routing
~~~

Fusion is intentionally not part of the v2 retained product scope. The Go Combo implementation covers retained ordered fallback and round-robin/sticky behavior only unless Fusion is separately reintroduced later.

### 9.5 System One/Jev flow

System One remains a first-class ingress/transport family rather than a dashboard-only special case.

~~~text
/v1/systemone
  -> LiteRouter API auth
  -> System One request validation
  -> provider/model route
  -> upstream credential kept server-side
  -> upstream native request
  -> response passthrough/normalization as required
  -> Usage/request detail telemetry
~~~

Its Usage semantics and current provider catalog behavior must receive dedicated compatibility tests.

## 10. Provider architecture

### 10.1 Separation of provider and protocol

Provider identity and wire protocol must not be treated as the same thing.

Example conceptual interfaces:

~~~text
ProviderAdapter
  ID
  credential preparation
  endpoint resolution
  provider-specific headers
  provider-specific error classification
  token refresh hooks
  quota/reset hooks

ProtocolAdapter
  decode inbound
  encode upstream
  translate response stream
  report protocol capabilities
~~~

A generic OpenAI-compatible provider should primarily reuse the OpenAI protocol adapter plus endpoint/credential configuration rather than require a new full executor implementation.

### 10.2 Provider registry

The provider registry contains:

- canonical provider ID;
- aliases;
- service kinds;
- supported protocol families;
- authentication kinds;
- model catalog source;
- provider adapter factory;
- capability metadata.

Heavy provider initialization must remain lazy.

### 10.3 HTTP transport reuse

Create transport pools keyed only by properties that affect connection reuse, for example:

- outbound proxy identity;
- TLS policy;
- target transport constraints.

Do not create a new HTTP client/transport for every request.

Define explicit limits for:

- idle connections;
- idle connections per host;
- idle timeout;
- response-header timeout where appropriate;
- connect timeout;
- maximum request duration policy.

Defaults must be benchmarked against streaming workloads rather than copied from generic HTTP service defaults.

## 11. Persistence architecture

### 11.1 SQLite remains authoritative

For the v2 single-instance topology, SQLite remains the durable system of record.

Reasons:

- current deployment is single-instance;
- the dataset already exists;
- migration risk is materially lower;
- WAL is sufficient for the existing write profile when telemetry is batched;
- changing database technology is not necessary to achieve hot-path isolation.

### 11.2 Database access rule

Inference may not synchronously query SQLite for configuration after the runtime snapshot is ready.

Permitted request-time durable writes are exceptional compatibility operations only, such as a lock/reset state that has been explicitly classified as restart-durable. Even those writes must not block response streaming when they can be safely deferred.

### 11.3 Schema strategy

Preferred approach:

- preserve the existing SQLite schema initially where practical;
- implement Go repositories that can read the current database;
- add migrations only for state that cannot be represented safely in existing tables;
- do not migrate Usage history just to normalize old schema during the initial cutover.

A later cleanup migration may normalize schema after v2 has been stable in production.

### 11.4 Migration safety

Before any production cutover:

- SQLite integrity check passes;
- a versioned backup exists;
- table counts are captured;
- representative credentials/settings can be loaded by both old and new runtime where format compatibility is promised;
- rollback procedure is rehearsed against a copy of the production volume.

## 12. Telemetry and Usage architecture

### 12.1 Telemetry must be asynchronous

Request execution publishes lightweight events to a bounded in-process queue.

~~~text
request
  -> telemetry event
  -> bounded queue
  -> batch aggregator
  -> one SQLite transaction per batch
~~~

The telemetry path records the same product-visible information required by Usage and request details.

### 12.2 Queue classes

Do not treat every event as equally important.

Proposed classes:

Critical accounting:
- completed request;
- token counts;
- cost;
- status;
- provider/model/account identity needed for Usage.

Diagnostic:
- verbose request-detail payloads;
- extra transport metadata;
- trace events.

Under pressure:

- inference must not block indefinitely on telemetry;
- diagnostic events may be dropped/coalesced first;
- critical accounting overflow must produce an explicit metric/error signal;
- queue capacity and drop counters must be visible;
- shutdown must attempt bounded drain.

Exact durability semantics for accepted critical events must be documented before implementation.

### 12.3 Live events

The same internal event bus can feed the control-plane event stream.

Proposed event families:

- request.started
- request.finished
- request.failed
- provider.health.changed
- account.cooldown.started
- account.cooldown.cleared
- quota.updated
- config.changed
- usage.updated

The browser should not receive credentials or raw sensitive headers in live events.

### 12.4 Critical accounting overflow policy

Critical Usage/accounting events must never be silently dropped merely because the normal in-memory queue is full.

Normal behavior remains asynchronous and non-blocking. Under exceptional queue saturation:

1. diagnostic events shed first;
2. critical enqueue applies a short bounded backpressure window;
3. if capacity still cannot be obtained, the telemetry subsystem triggers an emergency batch/direct flush path;
4. if SQLite remains unavailable, inference may continue only with an explicit degraded-health signal and a monotonic lost-accounting counter if an event ultimately cannot be persisted.

The normal successful hot path still performs no SQLite write. Emergency persistence is an overload/failure path, not the default architecture.

Shutdown must stop accepting new requests, allow active streams a bounded drain window, flush accepted critical telemetry, perform safe WAL maintenance if configured, and only then close SQLite.

## 13. Control-plane API

### 13.1 Versioned API

Introduce a versioned admin API:

~~~text
/admin/v1/...
~~~

The existing /api routes remain during migration and may proxy to the new control service where useful. They are removed only after the static UI and compatibility requirements no longer depend on them.

### 13.2 Purpose-built overview

Replace browser-side joining of providers, keys, settings, health, and usage with one read model:

~~~text
GET /admin/v1/overview
~~~

Conceptual response:

~~~json
{
  "runtime": {
    "version": 42,
    "startedAt": "...",
    "healthy": true
  },
  "endpoint": {
    "basePath": "/v1",
    "protected": true
  },
  "providers": {
    "configured": 5,
    "ready": 4,
    "attention": 1
  },
  "keys": {
    "active": 3
  },
  "traffic": {
    "activeRequests": 2,
    "requestsToday": 100
  }
}
~~~

This payload is intentionally an operator read model, not a raw database dump.

### 13.3 Resource APIs

Proposed main resources:

- /admin/v1/providers
- /admin/v1/provider-nodes
- /admin/v1/combos
- /admin/v1/keys
- /admin/v1/settings
- /admin/v1/usage
- /admin/v1/requests
- /admin/v1/quota
- /admin/v1/token-saver
- /admin/v1/systemone
- /admin/v1/events

Mutation responses should return the new resource plus runtime snapshot version where useful, allowing the UI to know that the new config is active rather than merely persisted.

### 13.4 Query behavior

List endpoints must define:

- cursor or page pagination;
- stable sort;
- filters;
- maximum page size;
- field projection only where it materially improves payload size;
- consistent error envelope.

Usage/request-detail endpoints must not send unbounded history to the browser.

## 14. Dashboard rewrite

### 14.1 Target frontend

Preferred stack:

- React;
- TypeScript;
- Vite;
- TanStack Router;
- TanStack Query;
- a small local store only for ephemeral UI state;
- existing styling can be ported incrementally rather than redesigned again during architecture migration.

The architecture PRD does not require a visual redesign. The immediate UX objective is responsiveness, coherence, and lower runtime complexity.

### 14.2 Initial page load

Target overview flow:

~~~text
download static assets
  -> render shell
  -> GET /admin/v1/overview
  -> render useful state
  -> connect /admin/v1/events
~~~

Secondary data loads after the primary view is interactive.

### 14.3 Query invalidation

Mutations should update/query-invalidate only affected resources.

Example:

~~~text
disable provider
  -> PATCH /admin/v1/providers/:id
  -> server commits + snapshot swap
  -> response includes snapshotVersion
  -> query cache updates provider
  -> config.changed event confirms active version
~~~

Avoid page-wide refetches after every mutation.

### 14.4 Live updates

Use one SSE stream initially unless bidirectional requirements emerge.

SSE is sufficient because dashboard commands continue to use normal HTTP mutations.

The client must:

- reconnect with backoff;
- show connection state;
- not block normal page usage if SSE is unavailable;
- merge event deltas into query cache conservatively;
- periodically reconcile authoritative resources after reconnect.

## 15. Authentication and trusted-proxy model

### 15.1 Replace custom-server header patching with explicit ingress policy

The current Node custom server derives a client IP from the TCP peer and conditionally trusts forwarding headers from local reverse proxy traffic.

V2 must implement this directly in Go.

Rules:

- client-supplied internal trust headers are stripped;
- direct remote clients cannot mark themselves local;
- forwarding headers are accepted only from explicitly trusted proxy peers/networks;
- the effective client IP is computed once and stored in request context;
- auth/rate-limit/security middleware reads the computed context value rather than reparsing raw headers.

The exact trusted-proxy configuration must be explicit in production compose/config.

### 15.2 API keys

API-key validation should use the compiled snapshot.

A request should not query SQLite to validate an active key.

Key mutations persist and compile a new snapshot before success is returned.

### 15.3 Dashboard auth

Dashboard session/auth data may use SQLite-backed mutation/login operations, but normal authenticated admin requests should avoid unnecessary repeated expensive password work.

Session design must include:

- secure cookie settings;
- CSRF model for mutations;
- expiry;
- logout/revocation;
- no provider credential exposure.

## 16. Outbound network security

All provider and validation requests must go through one outbound-network policy layer.

It owns:

- URL parsing;
- allowed scheme checks;
- DNS resolution policy;
- private/link-local/metadata address blocking;
- redirect revalidation;
- proxy policy;
- timeout policy.

Provider validation must not have a separate weaker fetch implementation.

The policy must be unit-tested against:

- loopback;
- RFC1918/private addresses;
- link-local;
- metadata service destinations;
- IPv4-mapped IPv6;
- DNS rebinding/redirect cases that the current security boundary handles.

## 17. Detailed migration and daily-driver rollout plan

The rewrite is a strangler migration, but production data has one hard rule:

> **There is no live dual-writer phase. Exactly one application runtime owns the production SQLite database and rotating provider credentials at a time.**

WAL improves SQLite concurrency; it does not make two independently implemented application-level read-merge-write state machines safe. The migration therefore keeps Go read-only/offline until it also has enough control-plane compatibility to become the sole production database owner.

### Phase 0 - freeze an auditable compatibility manifest

Audit the then-current main, beginning from the 2026-09-23 baseline in section 5.

Deliverables:

- machine-readable manifest containing source main SHA;
- every public/rewrite route;
- every current API route;
- active and intentionally hidden provider registries;
- dashboard/operator workflows;
- settings/defaults and durable schema/KV scopes;
- retained transforms;
- background/runtime jobs;
- existing regression tests and their disposition;
- production deployment/environment assumptions;
- list of providers/accounts/models/Combos actually configured in a sanitized production snapshot;
- list of routes/models used recently where Usage data can provide it without exposing prompt content.

The manifest is reviewed before implementation starts and checked for drift before every later cutover.

### Phase 1 - differential harness and immutable production baseline

Deliver:

- golden request/response fixtures for every public transport family;
- mock upstreams for OpenAI Chat, Responses, Anthropic Messages, Gemini compatibility, Ollama compatibility, and System One;
- provider-specific fixtures for custom wire protocols;
- cache-stability fixtures;
- existing Node outputs captured for deterministic cases;
- DB fixture built from a sanitized current schema;
- benchmark harness targeting Node and Go with identical payloads;
- security fixtures;
- current-main latency/RSS/CPU/image/browser baseline.

This phase changes no production routing.

### Phase 2 - Go skeleton, store compatibility, and snapshot compiler

Deliver:

- `cmd/literouter`;
- configuration/environment loader;
- liveness/readiness;
- SQLite schema/version reader;
- migration framework compatible with the current database;
- immutable ConfigState/RuntimeSnapshot compiler;
- runtime state manager;
- exact mutation protocol from section 7.6;
- read-only loading of a production-copy database.

Gate:

- all current durable tables/KV scopes load;
- snapshot compile is deterministic;
- secrets never appear in diagnostics;
- corrupt/unsupported DB keeps readiness false;
- current database can still be opened by the Node rollback image.

### Phase 3 - public ingress/protocol parity

Implement and differentially test public surfaces before provider breadth:

1. model discovery/list/single-model/info;
2. OpenAI Chat Completions;
3. OpenAI Responses;
4. Responses compact;
5. Anthropic Messages;
6. Anthropic count_tokens compatibility;
7. System One;
8. Ollama-compatible `/v1/api/chat`;
9. Gemini-compatible `/v1beta` list/generate/stream;
10. current route aliases/rewrites and CORS behavior;
11. relevant h2c/client transport compatibility.

Native paths are implemented first, then translation paths.

No production credentials are used concurrently by Node and Go in this phase.

### Phase 4 - routing, providers, credentials, and transforms

Port the shared routing machinery:

- API-key validation;
- route compilation;
- aliases/custom/disabled models;
- account selection;
- fill-first/RR/sticky/per-provider strategies;
- model locks/cooldowns;
- Combo fallback/round-robin and per-combo `comboStrategies`;
- proxy pools/global outbound proxy;
- quota logic;
- token-saver/cache transforms.

Then migrate providers in reviewable groups.

For every provider moved:

- registry metadata parity;
- auth mode parity;
- credential refresh parity;
- model discovery parity;
- request/response wire parity;
- quota/reset/error classification parity;
- proxy behavior;
- Usage extraction;
- current provider-specific regression tests.

The 80-active-provider ledger must be fully classified before v2 is declared feature complete.

### Phase 5 - telemetry and complete Go control-plane compatibility

**This phase happens before production inference cutover.**

Deliver:

- Usage/history/request-details writer;
- critical-accounting overflow policy;
- live request/event stream;
- console logs;
- quota read models;
- Go admin/control APIs;
- compatibility endpoints required by the existing Next dashboard/CLI;
- provider/OAuth/import workflows;
- keys/settings/auth;
- model/alias/custom/disabled/pricing workflows;
- provider nodes and proxy pools;
- Combo/capability-adapter workflows;
- database backup/restore;
- Headroom management;
- PXPIPE compatibility;
- health endpoints.

At the end of Phase 5, Go must be capable of being the **only process that opens the production SQLite database for application writes**.

The existing Next dashboard may continue to render the UI, but after production cutover all its data/mutation calls must go to Go APIs. The Node UI process must have an explicit UI-only mode that:

- does not open/mutate the production SQLite database;
- does not run token-refresh/quota/background jobs;
- does not own provider credentials;
- does not append Usage/request details;
- does not perform server-side routing.

### Phase 6 - offline replay and safe canary validation

Verification order:

1. replay sanitized fixtures offline;
2. run Node and Go against deterministic mock upstreams;
3. run Go against a sanitized/copy database with no live credential rotation;
4. use dedicated canary provider accounts/API keys for selected live upstream smoke tests;
5. compare with current Node production behavior.

**Never allow Node and Go to concurrently use the same rotating OAuth refresh token merely for canary testing.** A refresh-token rotation by one runtime can invalidate the other runtime's durable token and turn a harmless canary into a production outage.

Live canary credentials must therefore be:

- dedicated to the canary; or
- non-rotating API keys safe for parallel use.

Compare:

- status/error;
- required headers;
- first event/TTFT;
- stream event sequence and terminal event;
- outbound normalized body;
- cache anchors;
- selected route/account where deterministic;
- retry/cooldown classification;
- Usage/accounting;
- request detail/redaction;
- cancellation.

### Phase 7 - production preflight and credential ownership transfer

Before touching edge routes:

1. regenerate the parity manifest against latest main;
2. build a production route matrix from the live DB/Usage metadata without copying prompt contents;
3. confirm every currently configured provider/account/model/Combo is implemented;
4. confirm every recently used public route is implemented;
5. run Node-side health/provider checks where safe;
6. checkpoint SQLite/WAL and create a versioned backup;
7. verify backup restore on a disposable copy;
8. verify rollback Node image can open the current schema;
9. disable new control mutations for the cutover window;
10. stop background jobs;
11. drain active Node inference requests;
12. stop the full Node runtime so it releases database and rotating-credential ownership.

Only after Node has relinquished ownership may Go open the live volume as writable.

### Phase 8 - controlled production cutover

Start Go with the live volume.

Startup must:

- open/migrate SQLite;
- compile the runtime snapshot;
- restore durable cooldown/credential/config state;
- become ready only when the active snapshot is valid.

Run local representative smoke checks before changing Caddy.

Then route all server-owned compatibility surfaces together:

~~~text
/v1/*       -> Go
/v1beta/*   -> Go
/responses  -> Go
/codex/*    -> Go
/api/*      -> Go compatibility/control API

/dashboard/*, /login, UI assets -> Node UI-only temporarily
~~~

This is deliberately **not** a split where Node control logic and Go inference logic both mutate SQLite.

Immediate post-cutover checks:

- configured daily-driver providers;
- one native streaming route;
- one translated route if used;
- one Combo/fallback route if used;
- model list;
- API-key auth;
- Usage append/live update;
- quota;
- admin mutation + snapshot version;
- login/dashboard;
- token refresh path when safely testable;
- backup/export.

If a gate fails, execute rollback immediately rather than patching production in place.

### Phase 9 - soak as the daily-driver core

Keep Node only as UI renderer while Go owns all server state and APIs.

During the soak window, monitor:

- unexpected 4xx/5xx by provider/model;
- fallback rate;
- cache-read/cache-create ratios;
- token-refresh failures;
- model locks;
- Usage/accounting gaps;
- telemetry pressure;
- RSS/CPU;
- stream cancellations;
- dashboard API errors;
- SQLite busy/checkpoint behavior.

Any main-branch feature added during the soak triggers parity-manifest drift review.

Do not remove the rollback image or make a forward-only schema change during this window.

### Phase 10 - static dashboard cutover

Build/port the Vite/React dashboard against the Go control API.

Port and browser-test all workflows in section 5.9.

Do not combine this phase with another large visual redesign. Preserve interaction semantics first; visual refinement can follow.

Gate:

- every visible dashboard route has workflow parity;
- authentication/session behavior is proven;
- no provider credential is exposed to browser JavaScript;
- accessibility/basic responsive smoke tests pass;
- cold and cached navigation meet the recorded performance budgets.

Then route dashboard/static assets to the new UI.

### Phase 11 - Node/Next removal

Only after all gates and the agreed soak window:

- remove Next production runtime;
- remove custom-server.js only after trusted-proxy/h2c compatibility is covered;
- remove Node inference/control modules;
- remove old private `/api` compatibility aliases only when no retained UI/CLI caller needs them;
- remove Redis from default compose if no explicitly retained function needs it;
- shrink production image;
- update README/runbooks;
- retain the pre-removal Node image and compatible DB backup for the rollback window.

## 18. Current-to-target modification map

This section is a planning map, not an instruction to delete files in the PRD PR.

| Current area | V2 destination | Migration rule |
| --- | --- | --- |
| src/sse/handlers/chat.js | internal/ingress + internal/routing | Replace responsibility-by-responsibility, not line-for-line |
| src/sse/services/auth.js | internal/routing/accounts + internal/auth | Split API auth from provider-account selection |
| open-sse/handlers/chatCore.js | protocol/provider execution layer | Preserve behavior through contract tests |
| open-sse/services/combo.js | internal/routing/combo | Compile Combo graph where possible |
| open-sse translator code | internal/protocol | Native path bypasses translation |
| src/lib/db/repos/* | internal/store | Durable state only; not runtime cache ownership |
| repository-local caches | internal/runtime snapshot | Replace with one coherent immutable snapshot |
| src/lib/redis.js | optional future coordination | Remove from default single-instance path |
| Usage/request-detail queues | internal/telemetry | Bounded typed queues + batched writer |
| custom-server.js | Go HTTP server/middleware | Reimplement trusted-proxy and h2/h1 behavior explicitly |
| Next /api routes | internal/control | Versioned admin API |
| Next dashboard pages | ui/ | Static React/Vite application |
| Zustand data-fetch state | TanStack Query + small UI store | Server state is query cache, not global UI state |
| Next standalone image | Go binary + static assets | Remove Node runtime after parity |

## 19. Performance acceptance

Performance gates must use the same host/container limits, same mock upstream, same payloads, same concurrency, and warmed processes.

### 19.1 Hard gates

V2 may not cut over if, on the agreed harness:

- controlled router p50 is worse than current main;
- controlled router p95 is worse than current main;
- TTFT overhead is worse on native streaming;
- throughput collapses under the existing 10-stream test;
- memory grows without a stable plateau after repeated bursts;
- telemetry queue blocks inference under expected load;
- UI overview becomes interactive slower than current production under the same browser/network profile.

### 19.2 Improvement targets

These are engineering targets, not claims about results before measurement:

- reduce controlled native routing overhead materially enough to justify the rewrite;
- reduce production runtime RSS below the current Node baseline under like-for-like configuration;
- reduce production image size by removing Next/Node runtime;
- reduce dashboard request fan-out on overview to one authoritative read plus one event stream;
- reduce JavaScript shipped for pages that do not need charts/topology;
- keep native stream transformation allocation near constant with response length.

Do not define public upstream p95 as the main rewrite KPI because upstream/network variance dominates it.

### 19.3 Benchmarks to record

For Node main and each v2 candidate:

- cold start;
- readiness time;
- idle RSS;
- post-burst RSS;
- CPU during concurrent streaming;
- request throughput against zero-delay mock;
- p50/p95/p99 router overhead;
- TTFT overhead;
- 1, 10, 50, and 100 concurrent streams where the host permits;
- cancellation cleanup;
- telemetry queue depth;
- SQLite batch write time;
- dashboard static asset size;
- overview API latency;
- dashboard initial usable render using a reproducible browser script.

### 19.4 Prompt-cache hit preservation

Prompt-cache behavior is a release-blocking compatibility surface, not an incidental translator detail.

The current LiteRouter code deliberately manipulates cache boundaries to preserve high cache-hit rates, especially for Claude/Anthropic-style traffic. V2 must reproduce the **effective cache semantics** before the corresponding route can cut over. A simpler implementation that merely forwards whatever cache markers the client supplied is not considered compatible.

Current behavior that must be captured in fixtures before porting includes:

- Claude passthrough cache anchors are applied only after normalization and all enabled token-saver/body transforms, so the cache boundary describes the final upstream body rather than a pre-transform body.
- the last system block is re-anchored with an ephemeral 1-hour cache marker;
- the last cacheable tool is re-anchored with an ephemeral 1-hour cache marker;
- a tool with defer_loading=true must not also carry cache_control;
- the completed conversation tail is anchored on the last cache-eligible block of the latest assistant turn with the existing short-lived cache policy;
- when no assistant turn exists yet, the opening/final eligible message is anchored so the first conversational prefix can be reused;
- cache markers are kept within the upstream marker budget;
- mid-conversation system content is folded in place rather than blindly hoisted ahead of the conversation when doing so would make a volatile block invalidate the stable prefix;
- thinking/redacted-thinking blocks are not used as cache-control anchors;
- provider quirks that require cache_control to survive an OpenAI-format normalization path remain supported.

V2 must also preserve cache accounting exposed by upstream providers and by LiteRouter Usage:

- cached token counts;
- cache-read token counts;
- cache-creation token counts where reported;
- any provider-specific cache fields currently retained by the public/request-detail contract.

Cache compatibility must be tested at the **outbound request-body level** and, where an upstream exposes cache-read/create counters deterministically enough for testing, at the observed response/Usage level.

Required cache differential fixtures:

1. stable system + stable tool catalog + growing conversation;
2. first-turn request with no assistant history;
3. subsequent turn with a previous assistant response;
4. tool list containing defer_loading=true at the tail;
5. requests already carrying client cache_control markers;
6. requests at and beyond the upstream cache-marker budget;
7. mid-conversation system/reminder blocks that vary between turns;
8. thinking-enabled Claude requests;
9. token-saver disabled;
10. each retained token/body transform enabled independently and in supported combinations;
11. account fallback retries using the same logical request;
12. Combo fallback from a non-Claude provider to a Claude-format provider;
13. OpenAI-compatible providers whose quirk configuration preserves cache_control.

For deterministic fixtures, Node and Go outbound bodies must be compared after normalizing only values that are intentionally nondeterministic. Cache-control placement, TTL, message/tool ordering, and the cacheable prefix are **not** normalizable differences.

Add a cache-stability regression harness that generates request N and request N+1 from the same conversation and verifies that the serialized upstream prefix through the intended cache breakpoint is unchanged unless a configured transform intentionally changes that prefix.

The inference cutover is blocked if the Go path produces lower cache reuse than current main on the controlled cache fixture set. If a live provider is used for confirmation, compare cache-read/cache-creation counters over repeated identical-prefix requests, but do not make an unstable public-provider measurement the only correctness proof.

## 20. Correctness and test strategy

### 20.1 Contract tests

Every public ingress family gets tests for:

- non-streaming success;
- streaming success;
- malformed JSON;
- missing model;
- missing/invalid key;
- unsupported model;
- upstream 401/403;
- upstream 429/reset;
- upstream 5xx;
- timeout;
- disconnect;
- fallback;
- all accounts unavailable.

### 20.2 Differential tests

Feed the same fixtures into Node and Go and compare normalized outputs.

Fields that are intentionally nondeterministic, such as generated request IDs or timestamps, must be normalized explicitly. Do not weaken comparisons with broad JSON subset assertions when clients rely on exact shape.

### 20.3 Concurrency tests

Include deterministic tests for:

- provider-local round-robin fairness;
- unrelated providers progressing concurrently;
- Combo cursors independent from provider account cursors;
- config snapshot swap while requests are active;
- requests started before a config swap completing against their original snapshot;
- new requests observing the new snapshot;
- cooldown updates racing with selection;
- telemetry pressure;
- graceful shutdown with active streams.

### 20.4 Persistence tests

Using real SQLite:

- open current production-schema fixture;
- migrate if needed;
- compile snapshot;
- mutate each control-plane resource;
- restart;
- confirm durable state;
- verify Usage history unchanged;
- verify request-detail pagination and filters.

### 20.5 Security tests

At minimum:

- spoofed X-Forwarded-For does not create local trust;
- trusted proxy forwarding works;
- untrusted proxy forwarding is ignored;
- remote dashboard/inference auth remains enforced;
- SSRF cases remain blocked;
- redirects are revalidated;
- API keys/credentials are redacted from logs/events;
- static dashboard cannot fetch upstream provider credentials.

## 21. Observability

V2 should expose operational metrics independent from dashboard rendering.

Minimum internal metrics:

- active requests;
- request count by ingress;
- request count by provider/model;
- native vs translated route count;
- fallback count;
- account retry count;
- upstream status classes;
- upstream connect/TTFT/total latency;
- router pre-upstream overhead;
- runtime snapshot version;
- snapshot compile duration/failure count;
- telemetry queue depth;
- dropped diagnostic events;
- critical telemetry overflow count;
- SQLite batch duration/size;
- live-event subscribers.

Logs should be structured enough to correlate:

- request ID;
- public model;
- resolved provider/model;
- account ID in safe/redacted form;
- route mode;
- fallback step;
- status;
- timing.

Successful high-volume request logs must remain configurable so logging does not become the new hot-path bottleneck.

## 22. Failure behavior

### 22.1 Snapshot compile failure

A bad admin mutation must not partially activate.

The API returns failure and the previous known-good runtime snapshot remains active unless the database transaction has already committed. The final chosen commit/compile protocol must guarantee a deterministic state and be covered by tests.

### 22.2 SQLite temporarily busy

Inference using an already-loaded snapshot continues.

Admin mutations may fail/retry with a bounded policy.

Telemetry batches retry according to a bounded policy and expose pressure metrics.

### 22.3 Telemetry overload

Inference continues.

Diagnostic telemetry sheds first.

Critical telemetry pressure is surfaced immediately and must never silently grow memory without bound.

### 22.4 Provider failure

Existing account/provider/Combo fallback semantics apply.

V2 must not convert every provider error into generic 500.

### 22.5 UI event stream down

REST control plane remains usable.

The UI displays stale/live status and reconnects; it must not become unusable because the event stream is unavailable.

## 23. Deployment topology

Initial production target:

~~~text
Caddy
  |
  +-- /v1/* ----------> literouter:20128
  +-- /admin/v1/* ----> literouter:20128
  +-- /dashboard/* ---> static LiteRouter UI

literouter
  |
  +-- /app/data/literouter.sqlite

Redis: absent by default
~~~

Keep the external hostname and client endpoint stable.

The exact static UI serving choice is implementation-dependent:

Option A:
- Caddy serves ui/dist;
- Go only serves APIs.

Option B:
- UI embedded into Go binary;
- Go serves static assets;
- Caddy remains reverse proxy/TLS only.

Benchmark image size, cache headers, and deployment simplicity before choosing.

## 24. CI/CD modification plan

During migration, CI should contain separate gates.

### Existing Node lane

Retain until Node is removed:

- current test suite;
- production Next build;
- current compatibility/security tests.

### Go lane

Add:

- gofmt check;
- go vet;
- unit tests;
- race-enabled focused concurrency tests where CI budget permits;
- integration tests with SQLite;
- protocol contract tests;
- benchmark smoke tests;
- production binary build.

### UI lane

Add:

- TypeScript check;
- lint;
- unit/component tests;
- production Vite build;
- bundle-size budget;
- browser smoke tests for critical workflows.

### Cross-runtime compatibility lane

Until cutover:

- build Node and Go;
- run differential fixtures against both;
- compare normalized output;
- run the same mock latency/concurrency harness;
- publish comparison artifact.

No implementation phase is "done" solely because Go tests are green; compatibility comparison is a first-class gate.

## 25. Pull-request sequencing

Do not implement v2 in one enormous PR.

Recommended dependency order:

1. docs: approve audited v2 architecture/rollout PRD;
2. test: add generated parity manifest + main-drift checker;
3. test: add differential fixtures/mock upstreams/benchmark harness;
4. feat(v2): Go skeleton, health, current SQLite read compatibility, snapshot compiler;
5. feat(v2): config mutation protocol + compatible store layer on fixture databases;
6. feat(v2): model discovery + OpenAI Chat native path;
7. feat(v2): Responses + compact;
8. feat(v2): Anthropic Messages + count_tokens;
9. feat(v2): System One + Ollama compatibility + Gemini v1beta compatibility;
10. feat(v2): routing/account strategies/cooldowns/proxy behavior;
11. feat(v2): Combo fallback/round-robin + `comboStrategies` parity;
12. feat(v2): cache/RTK/Caveman/Ponytail/Headroom/PXPIPE transforms;
13. feat(v2): providers in bounded groups with provider-specific differential tests;
14. feat(v2): telemetry/Usage/request-details/console/live events;
15. feat(v2-control): auth/keys/settings/models/providers/provider-nodes/proxy-pools/combos/pricing/quota;
16. feat(v2-control): OAuth/import/provider-specific control workflows + backup/restore;
17. feat(node-ui): explicit UI-only mode consuming Go APIs and never opening live SQLite;
18. ops(v2): side-by-side *non-production-writer* deployment and dedicated-canary support;
19. perf(v2): publish Node-vs-Go benchmarks and cache-parity evidence;
20. release(v2): controlled credential/database ownership transfer and Go core cutover;
21. soak(v2): daily-driver observation fixes, still schema-backward-compatible;
22. feat(v2-ui): static UI shell + overview;
23. feat(v2-ui): port every remaining operator workflow in bounded PRs;
24. release(v2-ui): static dashboard cutover;
25. cleanup(v2): remove obsolete Node/Next runtime after rollback window.

Each implementation PR must state:

- parity-manifest entries moved;
- exact current-main SHA used for comparison;
- Node behavior that remains authoritative;
- relevant existing regression tests and their disposition;
- differential result;
- durable-state impact;
- credential-ownership impact;
- rollback impact;
- benchmark/cache impact when the hot path changes.

## 26. Review and merge discipline

Because this project uses automated review and a serialized review queue, v2 work should avoid stacking many dependent PR heads awaiting review.

Preferred discipline:

- one active implementation PR per dependency chain;
- keep changes reviewable and independently testable;
- after review findings, bundle related fixes into one push rather than repeatedly pushing tiny fix commits;
- do not delete old runtime code in the same PR that introduces an unproven replacement;
- only remove compatibility code after the replacement has run in production and rollback criteria are satisfied.

## 27. Cutover gates

### 27.1 Go server ownership gate

Go may not become the production database/credential owner until all of these pass:

- parity manifest refreshed against latest main;
- all public route families used by the deployment classified and implemented;
- every currently configured provider/account classified and implemented;
- every configured Combo using retained fallback/round-robin behavior implemented;
- contract suite green;
- differential suite green;
- prompt-cache parity green;
- security/SSRF/trusted-proxy suite green;
- relevant existing Node regression tests classified and covered;
- production-copy SQLite load/compile succeeds;
- backup + disposable restore rehearsal succeeds;
- API keys/login/auth parity succeeds;
- model-list/model-info parity succeeds;
- Usage/request-detail parity succeeds;
- quota/cooldown/reset semantics succeed;
- OAuth/token-refresh tests succeed for configured OAuth providers;
- streaming/non-streaming terminal and cancellation tests succeed;
- controlled p50/p95/TTFT not worse than approved baseline;
- concurrent CPU/RSS/queue behavior acceptable;
- Go control API covers every current dashboard mutation needed during Node UI-only phase;
- Node UI-only mode proves it does not open/mutate production SQLite or run credential/background jobs;
- rollback rehearsal succeeds;
- reviewer blockers resolved.

### 27.2 Static dashboard gate

Static UI cutover additionally requires:

- every visible dashboard route in section 5.9 ported;
- all current critical workflows browser-tested;
- login/logout/password/require-login behavior proven;
- endpoint/API-key workflow proven;
- provider/add/import/test/reorder/proxy workflows proven;
- Combo fallback/round-robin and per-combo strategy workflow proven;
- System One workflow proven;
- Usage/Quota/log/detail/topology live behavior proven;
- Token Saver/Headroom behavior proven;
- Settings/proxy/observability/database backup+restore proven;
- no secrets/provider credentials exposed to the browser;
- cold/cached interaction budgets met.

### 27.3 Node removal gate

Node/Next removal additionally requires:

- stable daily-driver soak completed;
- no unclassified parity-manifest drift;
- no required production Next API route remains;
- no retained CLI/tool depends on an endpoint scheduled for removal;
- schema remains rollback-compatible or a tested reverse migration exists;
- immutable rollback artifact retained;
- final rollback rehearsal succeeds.

## 28. Rollback plan

### 28.1 Core cutover rollback

Because production never runs two live SQLite writers, rollback is an ownership transfer, not a race between runtimes.

Procedure:

1. stop accepting new Go requests at the edge;
2. drain active Go streams for the bounded shutdown window;
3. flush accepted critical telemetry;
4. stop Go and release SQLite/credential ownership;
5. verify SQLite integrity/checkpoint state;
6. start the known-good full Node image against the same backward-compatible volume;
7. wait for Node health/readiness;
8. route `/v1*`, `/v1beta*`, aliases, and `/api/*` back to Node;
9. run representative auth/model-list/native-stream/Usage checks;
10. preserve failed Go logs, config revision, runtime snapshot version, and image SHA for diagnosis.

Do not leave Go running read/write against the live volume after rollback.

### 28.2 Database rollback

Before core cutover, keep:

- a checkpointed pre-cutover DB backup;
- the exact schema version;
- the exact Node image SHA.

Until the rollback window closes, v2 migrations must be additive/backward-compatible with that Node image. A forward-only schema change is prohibited during the daily-driver soak unless a tested reverse migration is delivered in the same change.

Database restore/import uses the safe procedure in section 7.7; do not overwrite the live database with an unvalidated backup.

### 28.3 OAuth credential rollback

Rotating OAuth credentials require special care.

Once Go owns production credentials, Node must not refresh them in parallel. If Go refreshes a token before rollback, the updated credential must already be durably stored in the shared database so the restarted Node image reads the newest token pair.

Rollback tests for configured OAuth providers must cover this handoff.

## 29. Risks and mitigations

### Risk: rewrite silently changes edge-case provider behavior

Mitigation:
- differential fixtures;
- provider-by-provider migration;
- no simultaneous cleanup and porting;
- Node remains oracle during transition.

### Risk: Go is faster but public latency looks unchanged

Expected:
- upstream dominates public-model latency.

Mitigation:
- judge data-plane success using controlled router overhead, TTFT overhead, CPU, RSS, throughput, and maintainability;
- report public endpoint latency separately.

### Risk: SQLite or rotating-credential dual ownership

Mitigation:
- production has exactly one application writer/credential owner at a time;
- Go is read-only/offline before the ownership-transfer cutover;
- Node becomes UI-only after Go takes ownership;
- no live shared-refresh-token canary between Node and Go;
- rehearse ownership transfer and rollback against a production-copy database;
- keep schema backward-compatible through the rollback window.

### Risk: static UI loses convenient Next behavior

Mitigation:
- explicitly define admin API read models;
- use query cache and event stream;
- browser smoke tests;
- do not rely on server components for operator workflows.

### Risk: telemetry queue loses events

Mitigation:
- separate critical and diagnostic importance;
- bounded queues;
- visible drop/overflow metrics;
- bounded shutdown drain;
- document durability contract.

### Risk: configuration swap serves mixed state

Mitigation:
- one immutable snapshot object;
- atomic replacement;
- a request holds one snapshot reference for its lifetime;
- snapshot version attached to diagnostics.

### Risk: migration grows indefinitely

Mitigation:
- phase gates;
- explicit Node deletion milestone;
- do not add new features only to old architecture after v2 reaches active migration unless production-critical.

## 30. Decisions proposed by this PRD

Approval of this PRD means agreement with these architectural directions:

1. LiteRouter v2 core is implemented in Go.
2. The normal deployment remains a modular monolith, not microservices.
3. SQLite remains the initial durable source of truth.
4. Redis is not mandatory for the normal single-instance v2 runtime.
5. Request-serving configuration is one immutable compiled runtime snapshot.
6. Successful steady-state inference has no synchronous durable-store dependency.
7. Native protocol routing is a dedicated fast path that avoids unnecessary stream parsing.
8. Telemetry is bounded and asynchronous.
9. Provider identity is separated from wire-protocol adapters.
10. The control plane moves to a versioned Go admin API.
11. The production dashboard becomes a static React application rather than a Next runtime.
12. Migration is incremental, with the existing Node implementation acting as compatibility oracle until each path is proven.
13. External inference contracts and durable production data take priority over preserving internal 9Router architecture.

## 31. Open implementation decisions

These choices remain open, but none may weaken the compatibility/rollout gates above:

- exact Go router/HTTP library: standard `net/http` is the default unless benchmark evidence justifies another dependency;
- exact SQLite driver after evaluating CGO/static-image implications and current schema/backup compatibility;
- whether the final static UI is Caddy-served or embedded;
- exact queue capacities, bounded backpressure duration, and degraded-health thresholds for critical telemetry;
- exact browser-performance budget numbers after capturing a reproducible baseline;
- exact duration/traffic criteria for the daily-driver soak window.

The following are **not** open anymore:

- no production dual-writer phase;
- Caveman, Ponytail, Headroom, and PXPIPE are hard-retained daily-driver features;
- `providerStrategies` and `comboStrategies` are hard-retained routing configuration contracts;
- Fusion and capability/capacity adapters are explicitly not retained in v2;
- Redis is not required for single-instance v2;
- all active provider registry entries require explicit migration disposition;
- current public compatibility routes beyond the three primary LLM endpoints are part of the parity audit.

## 32. Definition of done

LiteRouter v2 is complete only when:

- parity manifest is refreshed against the final migration main SHA with no unclassified drift;
- all retained public inference/discovery/compatibility contracts are served by Go;
- all 80 active providers from the audited baseline, plus any later active providers, have an explicit reviewed disposition;
- all providers/accounts configured in the production daily-driver database work through the v2 path;
- all retained provider/account/Combo fallback/round-robin behavior and `providerStrategies`/`comboStrategies` semantics pass compatibility tests;
- prompt-cache behavior does not regress on controlled fixtures;
- OAuth/token refresh and credential rotation are durable and rollback-safe;
- API keys, login/session, provider management, model catalog, aliases/custom/disabled models, pricing, proxy pools, `providerStrategies`, `comboStrategies`, RTK, Caveman, Ponytail, Headroom, PXPIPE, backup/restore, Usage, request details, quota, logs, and System One are served without the full Node runtime;
- every visible current dashboard workflow has static-UI parity;
- steady-state inference performs no synchronous SQLite/Redis lookup for configuration;
- native streaming does not perform unnecessary protocol re-encoding;
- telemetry is asynchronous in the normal path, bounded, and does not silently discard critical accounting on ordinary queue saturation;
- existing production data migrates without manual row editing;
- exactly one runtime owns production SQLite writes/rotating credentials during migration;
- production image no longer requires Next/Node after the rollback window;
- benchmark report demonstrates no regression against the approved baseline;
- cache, concurrency, cancellation, DB restore, and security suites pass;
- daily-driver soak completes without unresolved correctness blockers;
- rollback has been rehearsed after the final schema used for cutover;
- the retained rollback image can still open the database until the rollback window closes;
- obsolete Node/Next paths are removed only after those conditions are satisfied.

The migration optimizes for a boring daily driver: correctness, credential safety, cache-hit preservation, and reversible rollout take precedence over deleting the old runtime quickly.
