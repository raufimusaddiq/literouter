# PRD: LiteRouter Minimal — Fast Multi-Provider Router

**Status:** Proposed  
**Baseline:** current `main` (9Router-derived, package version `0.5.81` at PRD creation)  
**Scope:** product and architecture requirements only; no implementation in this PR

## 1. Problem

LiteRouter is derived from 9Router, but the current product surface is much larger than the deployment needs for this repository.

The target deployment needs a lightweight, fast, self-hosted AI routing gateway with a web UI. The valuable parts are:

- multiple providers and multiple accounts,
- OAuth and API-key provider connections,
- round-robin account/provider selection,
- combo routing and automatic fallback,
- quota-aware routing,
- three primary LLM transports,
- transparent protocol translation only when it is actually required,
- full existing Usage and Quota experiences,
- RTK, Caveman, and Ponytail token-saving behavior.

Features outside that routing/control-plane purpose should not remain on the critical path and should be removed, hidden, or made optional.

The objective is **not** to rewrite LiteRouter from scratch. The objective is to reduce the product and runtime surface while preserving the routing capabilities that are actively used.

---

## 2. Product principles

### 2.1 Router first

LiteRouter is a routing gateway, not a general AI platform.

The primary request path should be:

```text
client
  -> authenticate
  -> resolve model / combo
  -> choose provider + account
  -> optional token saver
  -> native passthrough OR protocol translation
  -> upstream
  -> usage/quota instrumentation
  -> client
```

Anything not required by this flow or by the retained admin UI must not add work to the request hot path.

### 2.2 Native transport before translation

Protocol translation is a compatibility mechanism, not the default behavior.

If the selected upstream supports the same transport used by the client, LiteRouter MUST use native passthrough.

### 2.3 Preserve operational visibility

Optimization must not reduce the information currently available in:

- `/dashboard/usage`
- `/dashboard/quota`

Those two pages are compatibility contracts.

### 2.4 Keep configuration simple

All retained functionality must remain configurable from the web UI. LiteRouter must not require editing source code to add a normal API-key or compatible provider.

### 2.5 Focused profile, not a rewrite

This initiative is a focused 9Router-derived profile.

It MUST prefer extraction, feature boundaries, lazy initialization, and dependency pruning over replacing the routing engine with a new platform.

The first supported target is a single production-like LiteRouter process using in-memory runtime state, Redis for shared/ephemeral runtime state where useful, and SQLite for durable configuration/history. Multi-replica coordination is explicitly deferred until there is a concrete need, but Redis support should not depend on multi-replica mode.

---

## 3. Goals

1. Reduce idle/runtime overhead and remove unnecessary subsystems.
2. Keep routing fast and predictable.
3. Keep a web admin UI.
4. Keep multi-provider and multi-account support.
5. Keep round-robin behavior.
6. Keep Combo routing and automatic fallback behavior.
7. Keep quota-aware account/provider selection.
8. Keep OAuth refresh and credential management required by supported providers.
9. Keep API-key providers and custom compatible upstreams.
10. Keep model aliases/model mapping required by routing.
11. Keep RTK, Caveman, and Ponytail.
12. Preserve the current Usage page completely.
13. Preserve the current Quota page completely.
14. Support native passthrough for compatible upstream transports.
15. Continue supporting protocol translation when native passthrough is impossible.

---

## 4. Non-goals

The minimal profile does not need to be a general AI workstation or feature showcase.

Unless required as a dependency of a retained feature, the following are outside the target product:

- built-in basic chat playground,
- media-provider management,
- image/video generation product surfaces,
- speech/STT/TTS product surfaces,
- embeddings product surfaces,
- skills marketplace / skills UI,
- MITM product surface,
- CLI tool configuration writers,
- separate translator playground UI,
- proxy-pool product UI,
- cloud sync,
- promotional/onboarding flows,
- provider recommendation/marketing surfaces,
- notification/reporting features unrelated to routing,
- other secondary platform features that are not used by the routing gateway.

The following are deferred from the minimalization initiative unless a retained feature proves they are required:

- multi-replica/distributed routing coordination,
- new OAuth provider integrations,
- new media capabilities,
- dashboard redesigns, especially Usage and Quota.

Removal must be dependency-aware. A library/module may remain internally when required by a retained feature, but it should not be initialized or exposed merely because it existed upstream.

---

## 5. Required ingress transports

LiteRouter MUST continue exposing these client-facing transports:

### OpenAI Chat Completions

```text
POST /v1/chat/completions
```

### OpenAI Responses

```text
POST /v1/responses
```

### Anthropic Messages

```text
POST /v1/messages
```

Streaming and non-streaming behavior must remain supported.

Model discovery endpoints required by current clients may remain where needed.

---

## 6. Provider model

LiteRouter must keep two provider classes.

### 6.1 First-class adapters

Use provider-specific adapters when special behavior is required, for example:

- OAuth,
- token refresh,
- subscription quota discovery,
- non-standard authentication,
- non-standard model discovery,
- provider-specific request semantics.

The existing **LLM/text provider catalog is a compatibility contract** for the minimal product.

Any current provider whose effective service kind includes `llm` must remain available through the Providers UI and routing engine, including the current connection modes where applicable:

- free/no-auth providers,
- free-tier providers,
- OAuth providers,
- API-key providers,
- web-cookie/session providers,
- dual-auth providers.

A provider adapter must not be removed merely because it is rarely used. It may only be removed from the minimal product when it is media-only/non-LLM, superseded by a fully compatible Generic Provider path without losing auth/quota semantics, or explicitly removed by a later product decision.

Provider-specific adapters should not all perform work at startup. They should be lazy-loaded or initialized on demand where practical.

### 6.2 Generic compatible providers

A Generic Provider MUST support independent transport capabilities.

Example conceptual configuration:

```yaml
name: my-upstream
base_url: https://example.com

transports:
  chat_completions:
    mode: native
    path: /v1/chat/completions

  responses:
    mode: native
    path: /v1/responses

  messages:
    mode: native
    path: /v1/messages
```

A provider may support:

- only one transport,
- two transports,
- all three transports.

The UI must allow these capabilities to be configured without source changes.

Optional capability probing may be added, but manual configuration must always be possible.

Generic Provider management must retain the useful connection workflow that exists today:

- test/validate credentials and endpoint,
- discover models when a compatible model-list endpoint exists,
- allow a manual model ID when discovery is unavailable,
- show connection/health status,
- support multiple connections/accounts where the routing model permits it.

Existing `openai-compatible` and `anthropic-compatible` nodes must remain readable and migratable. The new Generic Provider model should unify their capabilities rather than requiring users to recreate working connections manually.

A Generic Provider may use one shared credential/base URL for all enabled transports, with an optional per-transport path override. Per-transport base URL or header overrides may be added only when required by a real upstream compatibility case; they are not required for the first minimal implementation.

---

## 7. Native passthrough contract

This is a hard requirement.

If:

```text
incoming transport == supported native upstream transport
```

then LiteRouter MUST prefer:

```text
native passthrough
```

instead of:

```text
incoming format
  -> translate to internal/other format
  -> translate again
  -> upstream
```

### Examples

#### Responses -> Responses

```text
POST /v1/responses
       |
       v
Generic Provider supports /v1/responses
       |
       v
POST upstream /v1/responses
```

No Chat Completions conversion should occur.

#### Messages -> Messages

```text
POST /v1/messages
       |
       v
Generic Provider supports /v1/messages
       |
       v
POST upstream /v1/messages
```

No OpenAI conversion should occur.

#### Chat Completions -> Chat Completions

Same rule.

### Passthrough behavior

Native passthrough should preserve unknown/forward-compatible request fields wherever safe.

LiteRouter may still modify data required for retained router features, including:

- provider authentication,
- base URL and endpoint path,
- routed model name/model alias,
- account-specific headers,
- RTK/Caveman/Ponytail transformations when enabled,
- safe hop-by-hop header filtering.

Usage instrumentation may inspect/tee streams but should not force protocol conversion.

The required request-processing precedence is:

```text
resolve route/provider
  -> use native transport when available
  -> apply only explicitly enabled request transforms
     (RTK / Caveman / Ponytail as applicable)
  -> translate only when native transport is unavailable
  -> send upstream
```

"Native passthrough" means no protocol conversion is performed. It does not require byte-for-byte forwarding when an explicitly enabled transform needs to parse or modify the body.

When no transform is enabled, unknown/forward-compatible JSON fields must be preserved wherever safe and LiteRouter should avoid unnecessary body reconstruction.

If token-saving transforms are disabled, the router should avoid unnecessary request-body reconstruction.

---

## 8. Translation fallback

When the chosen upstream does not support the incoming transport natively, LiteRouter may use the existing translation layer.

Conceptually:

```text
Responses -> Chat Completions
Responses -> Anthropic Messages
Messages  -> Chat Completions
Chat      -> Anthropic Messages
...
```

Only valid, tested conversion paths should be enabled.

Routing selection must understand whether a candidate can serve a request:

- natively, or
- through an available translator.

Native candidates should be preferred when routing policy otherwise considers them equivalent.

---

## 9. Routing capabilities to preserve

### 9.1 Multi-provider

A deployment can connect multiple provider types simultaneously.

### 9.2 Multi-account

A provider can have multiple accounts/connections.

### 9.3 Round-robin

Current round-robin semantics must be preserved.

Round-robin state should live in memory on the hot path and should not require a synchronous database operation per request.

### 9.4 Account fallback

Keep the existing account fallback behavior, including handling of temporary unavailability, quota/rate-limit state, and cooldown where currently supported.

### 9.5 Combo routing

The existing Combo feature is core product functionality.

The minimal Combo product MUST retain:

- ordered fallback,
- round-robin/pool behavior,
- automatic progression to another candidate after eligible failures,
- cross-provider and cross-account targets,
- reorder/edit semantics in the existing Combo UI.

The first minimal profile does **not** require Fusion/panel+judge or capability-adapter routing. Those may remain disabled/removed unless explicitly brought back by a later product decision.

Do not simplify Combo into a static alias.

Combo routing must work across providers and accounts.

### 9.6 Auto fallback

When a selected account/provider is unavailable for a retryable reason, LiteRouter should automatically select the next eligible route according to the existing routing/combo policy.

Hard/non-retryable request errors must not create uncontrolled retry loops.

### 9.7 Quota-aware routing

Quota state is runtime routing input, not just analytics.

Provider/account quota and cooldown state required by current routing behavior must remain available in memory for fast decisions and persist where necessary.

---

## 10. RTK, Caveman, and Ponytail

These are retained features.

### 10.1 RTK

Keep the current RTK tool-result compression pipeline and current supported request shapes, including the current behavior for:

- OpenAI tool messages,
- OpenAI Responses function call output,
- Anthropic tool results,
- supported provider-specific shapes currently handled by RTK.

Existing safety behavior must remain:

- do not turn successful content into empty output,
- do not expand content,
- preserve error traces where the current implementation preserves them,
- failure in token saving must not fail the LLM request.

### 10.2 Caveman

Keep Caveman and its configurable prompt/system behavior.

### 10.3 Ponytail

Keep Ponytail and its configurable prompt/system behavior.

### 10.4 Token Saver UI

Keep the UI required to enable/configure/observe RTK, Caveman, and Ponytail.

Features such as Headroom/PXPipe are not automatically product requirements merely because they exist in the current RTK directory. They may remain only if they are required dependencies or explicitly retained later.

---

## 11. Usage compatibility contract

`/dashboard/usage` MUST NOT lose functionality.

The implementation must preserve the current page behavior, data, filters, visualizations, and detail views.

At PRD creation the page includes the existing Usage experience backed by components such as:

- usage overview/stat cards,
- current time-period selector behavior,
- usage charts,
- usage tables,
- provider topology,
- request details,
- current details/log information reachable from the Usage experience,
- existing token/cost/request/latency/error information where currently shown.

### Hard acceptance rule

Before implementation changes are accepted:

1. capture the current `main` Usage UI and API behavior as the baseline;
2. run the same seeded traffic against baseline and minimal implementation;
3. verify the same user-visible metrics and drill-down information;
4. verify charts and filters continue to work;
5. verify request-detail information currently available remains available.

Internal storage/query implementation may be optimized, but the feature surface and results may not be reduced.

Usage writes should be moved off the synchronous routing path where safely possible, but **not** at the cost of missing or incomplete data.

If Usage persistence becomes asynchronous, the buffer MUST be bounded, must flush on graceful shutdown, and must not silently drop records required by the existing Usage contract. On saturation, the implementation must use an explicit fallback such as bounded backpressure or direct durable persistence rather than unbounded memory growth or silent loss.

---

## 12. Quota compatibility contract

`/dashboard/quota` MUST NOT lose functionality.

The current Provider Limits / quota experience is retained exactly in capability.

This includes, where currently available:

- connected provider/account quota information,
- reset/limit information,
- provider-specific limit views,
- states used by routing decisions,
- refresh/update behavior,
- existing visual representation.

Quota collection must remain decoupled from every normal request whenever polling/caching is possible, while current routing correctness must be preserved.

Runtime quota state must be explicit rather than inferred from missing values. At minimum the router should be able to distinguish:

```text
available
exhausted
cooldown
unknown
error
```

`unknown` and `error` are not equivalent to `exhausted`. Retry/fallback policy must define which states are eligible for another route and must always have a finite retry bound; no quota or provider failure may create an infinite fallback loop.

---

## 13. Web UI scope

The target navigation should focus on the gateway.

Required surfaces:

```text
Dashboard / Overview
Providers
Combos
Usage
Quota
Token Saver
Endpoint / API Keys / Settings
```

### Providers

Must continue supporting:

- list provider connections,
- add provider,
- edit provider,
- enable/disable provider connections where currently supported,
- remove provider,
- the existing LLM provider catalog and current auth modes,
- OAuth connection where currently supported,
- API-key connection,
- web-cookie/session connection where currently supported,
- Generic Provider,
- multiple accounts/connections,
- test/validate connection,
- model discovery plus manual model fallback,
- account/connection state,
- relevant model configuration,
- relevant quota/health state.

For Generic Provider, the UI must expose the three transport capabilities separately.

Example:

```text
Native transports

[x] OpenAI Chat Completions   /v1/chat/completions
[x] OpenAI Responses          /v1/responses
[x] Anthropic Messages        /v1/messages
```

The user may enable one, two, or all three.

### Combos

Keep the existing Combo management UX required to build and reorder routing targets and choose the retained routing behavior.

### Usage and Quota

Do not redesign away existing functionality as part of the minimalization work.

### Token Saver

Keep controls needed by RTK, Caveman, and Ponytail.

---

## 14. Hot-path architecture

The router hot path should avoid repeated configuration/database work.

Target model:

```text
request
  |
  +-- API key/auth check
  |
  +-- in-memory model/combo lookup
  |
  +-- in-memory provider/account selection
  |
  +-- optional RTK/Caveman/Ponytail
  |
  +-- native passthrough OR translator
  |
  +-- upstream request
  |
  +-- streaming response
       |
       +-- lightweight usage/quota observation
```

Frequently accessed runtime state should be cached in memory:

- provider connections,
- account eligibility,
- combos,
- model aliases/mappings,
- client API keys where safe,
- quota/cooldown state,
- round-robin cursors,
- provider transport capability metadata.

Persistent storage remains the source of durable configuration, not a mandatory synchronous lookup for every routing decision.


---

## 15. State, caching, and persistence strategy

LiteRouter MUST distinguish durable persistence from hot-path caching.

### 15.1 Default architecture: in-memory + Redis + SQLite

The default deployment may run Redis in the same Docker stack as LiteRouter.

```text
                         LiteRouter
                            |
             +--------------+--------------+
             |              |              |
             v              v              v
        in-memory L1      Redis          SQLite
        ------------      -----          ------
        providers         cooldown       durable config
        accounts          quota state    credentials metadata
        combos            RR counters    provider/account config
        aliases           health         combo definitions
        API-key lookup    cache version  aliases/settings
        transport caps    invalidation   complete Usage history
        local health      short TTL data quota snapshots
                         locks/counters   migrations
```

SQLite remains the durable source of truth.

In-memory state remains the fastest request-path cache.

Redis is a first-class runtime-state component for TTL state, counters, locks, invalidation, and other shared/ephemeral data.

A normal request MUST NOT require a synchronous SQLite lookup for configuration that is already cached and valid.

Configuration mutations from the UI must update durable storage and then invalidate/update the relevant in-memory state immediately.

### 15.2 SQLite is not the hot cache

SQLite should not be treated as an equivalent substitute for an in-memory cache.

SQLite remains appropriate for:

- durable configuration,
- Usage data required by the existing `/dashboard/usage` contract,
- persisted quota snapshots where necessary,
- settings and migrations,
- data that must survive process restart.

It should not be consulted synchronously for every:

- model resolution,
- Combo lookup,
- provider eligibility check,
- API-key lookup,
- round-robin selection,
- cooldown check.

### 15.3 Redis runtime state

Redis is an approved first-class component of LiteRouter minimal and may run as a separate container in the same Docker deployment.

Redis is appropriate for:

- cooldown and rate-limit TTL state,
- quota/runtime availability state that benefits from TTL,
- round-robin counters/cursors,
- health/runtime status,
- atomic counters,
- OAuth refresh locks,
- short-lived cache entries,
- configuration versioning/invalidation,
- future multi-replica coordination.

Redis MUST NOT become the sole durable source for provider, combo, Usage, or other configuration/history that must survive cache loss.

Conceptual multi-instance deployment:

```text
              +---- LiteRouter A ----+
client/load   |                      |
balancer -----+---- LiteRouter B ----+---- Redis
              |                      |       |
              +---- LiteRouter C ----+       +-- shared cooldown/quota
                                             +-- RR cursors
                                             +-- optional cache/counters

                         |
                         +---------------- SQLite / durable store
```

### 15.4 Cache ownership

Recommended ownership:

| State | Primary runtime owner | Durable/source owner |
| --- | --- | --- |
| Provider/account config | in-memory L1 | SQLite |
| Combo definitions | in-memory L1 | SQLite |
| Model aliases | in-memory L1 | SQLite |
| API-key lookup | in-memory L1 | SQLite |
| Transport capabilities | in-memory L1 | SQLite |
| Quota/cooldown | Redis + local read-through cache where useful | SQLite snapshot only if needed |
| Health state | Redis + local cache | ephemeral |
| Round-robin cursor | Redis atomic counter or local cursor with Redis checkpoint | ephemeral |
| OAuth refresh lock | Redis lock | ephemeral |
| Config version/invalidation | Redis | SQLite config remains source of truth |
| Usage history | optional Redis buffer/counters | SQLite |
| UI session/cache | Redis or memory | ephemeral |

### 15.5 Cache invalidation requirements

Cache correctness is more important than maximizing cache hit rate.

When Providers, Combos, aliases, API keys, or routing settings change through the UI:

1. write/commit the durable change;
2. invalidate or replace the corresponding in-memory object;
3. new requests must see the new configuration immediately after successful mutation;
4. stale cache must never require a process restart to clear.

Configuration changes should propagate through Redis versioning/pub-sub invalidation or an equivalent mechanism so in-memory L1 state cannot remain stale after a successful UI mutation.

### 15.6 Usage write path

The complete current Usage feature remains a hard requirement.

Where safe, Usage persistence should be decoupled from response streaming:

```text
upstream response
       |
       +----> client
       |
       +----> lightweight usage event
                    |
                 buffer/batch
                    |
                  SQLite
```

The event path must provide backpressure/bounded buffering and a safe shutdown flush policy. Optimization must not silently lose data required by `/dashboard/usage`.

Redis may act as the bounded short-lived buffer/counter layer for Usage aggregation before durable SQLite persistence, as long as the existing Usage contract is preserved and shutdown/recovery behavior is explicit.

### 15.7 Redis vs SQLite decision rule

Use **SQLite** when the state:

- must survive restart,
- is configuration/history,
- must be queryable for Usage/Quota UI,
- is not read-modified-written at very high distributed concurrency.

Use **in-memory state** when the state:

- is needed on almost every request,
- can be reconstructed from durable state,
- belongs to a single LiteRouter process.

Use **Redis** when the state:

- is hot/ephemeral,
- benefits from TTL,
- requires atomic counters or locks,
- needs configuration invalidation/pub-sub,
- may later be shared across multiple LiteRouter replicas.

For the expected initial LiteRouter deployment, the recommended architecture is:

```text
in-memory L1
    +
Redis runtime/shared state
    +
SQLite durable config + Usage history
```

Redis may run as a small dedicated container in the same Docker Compose stack as LiteRouter.

---

## 16. Startup/runtime minimization

Minimalization should target both code surface and runtime behavior.

Requirements:

- do not initialize unused subsystems at startup;
- do not schedule background jobs for removed features;
- lazy-load provider-specific integrations where practical;
- remove unused dashboard routes from the minimal product;
- remove large UI dependencies only when they are no longer required by retained pages;
- keep Usage/Quota chart dependencies that those pages need;
- keep only required production assets;
- avoid duplicate router/control-plane services when one process can serve the retained product safely.

No absolute RAM target is specified in this PRD because a reproducible baseline must be measured first.

Implementation PRs must publish before/after measurements for:

- idle RSS,
- startup time,
- production bundle/container size,
- request latency overhead,
- CPU under representative concurrent streaming traffic.

---

## 17. Features to retain

Hard-retain:

- web UI,
- client API-key authentication/current endpoint access model,
- `/v1/chat/completions`,
- `/v1/responses`,
- `/v1/messages`,
- SSE/streaming,
- multi-provider,
- multi-account,
- the existing LLM/text provider catalog,
- free/no-auth and free-tier LLM providers,
- OAuth/token refresh for retained LLM providers,
- API-key LLM providers,
- web-cookie/session LLM providers where currently supported,
- Generic Provider,
- per-transport native passthrough,
- protocol translation fallback,
- model aliases/mapping needed by routing,
- round-robin,
- account fallback,
- Combo,
- auto fallback,
- quota/cooldown/health routing state,
- current `/usage`,
- current `/quota`,
- RTK,
- Caveman,
- Ponytail,
- Token Saver configuration UI.

---

## 18. Features to remove or make optional

Initial candidates:

- Basic Chat,
- CLI Tools configuration UI,
- Console Log page if all required diagnostics remain available through retained Usage/details,
- Media Providers,
- MITM,
- Proxy Pools,
- Skills,
- Fusion/panel+judge Combo mode,
- capability-adapter routing UI/runtime when not required by retained routing,
- Translator playground UI,
- unrelated media endpoints,
- cloud sync,
- promotional landing/onboarding content,
- unused notification/reporting systems,
- unused provider-specific background services,
- unused i18n/runtime assets if LiteRouter intentionally becomes a single-language private deployment.

Each implementation PR must prove that removing a candidate does not break a retained feature.

Do not delete shared code solely by directory name; trace runtime dependencies first.

---

## 19. Compatibility and migration

Minimalization must be incremental.

Preferred strategy:

1. identify the retained product contract;
2. add feature boundaries/profile flags where useful;
3. stop initialization of non-retained features;
4. remove UI exposure for non-retained features;
5. measure;
6. only then delete dead implementation and dependencies.

Existing provider, combo, quota, usage, and token-saver configuration should migrate without manual database editing.

The deployment endpoint used by existing applications must not require application-level changes solely because LiteRouter becomes minimal.

### 19.1 Isolated staging requirement

Changes that alter the LiteRouter profile must be validated in an isolated staging deployment before production promotion.

Staging MUST NOT share mutable runtime state with production. At minimum it needs separate:

- container/process identity,
- listen port,
- SQLite/data volume,
- runtime network/namespace where practical,
- secrets/credentials or explicitly scoped staging credentials.

Exact Docker resource names and port numbers are deployment details, not part of the product contract. A deployment may use names such as `literouter-staging`, `literouter-staging-data`, and a dedicated staging port, but the PRD should not hard-code them.

Production data must be backed up before any migration that changes persisted state.

---

## 20. Testing requirements

### Routing

Test all three ingress transports with:

- native same-transport provider,
- translated provider,
- combo fallback,
- round-robin,
- multi-account fallback,
- quota-exhausted account,
- retryable upstream error,
- non-retryable upstream error,
- streaming,
- tool calls,
- reasoning fields where supported.

### Native passthrough

For Generic Providers supporting all three transports, verify:

- Responses ingress uses upstream Responses;
- Messages ingress uses upstream Messages;
- Chat Completions ingress uses upstream Chat Completions;
- unknown supported JSON fields survive routing;
- streaming event semantics remain valid;
- no translator is invoked in the native case.

### Token saving

Regression-test RTK, Caveman, and Ponytail independently and in supported combinations.

### Usage

Use seeded requests and compare baseline vs minimal:

- totals,
- tokens,
- costs,
- provider/model breakdown,
- latency,
- errors,
- topology,
- details,
- filters,
- graphs.

### Quota

Compare baseline vs minimal for the same provider/account fixtures.

### Combo

Preserve current combo behavior with deterministic tests for target ordering and failover.

---

## 21. Acceptance criteria

The minimalization initiative is complete only when all of the following are true:

- existing clients can continue using the same shared LiteRouter endpoint;
- all three primary transports work;
- Generic Provider can advertise one, two, or three native transports;
- native upstream transport is used without protocol translation when available;
- translation remains available as fallback compatibility;
- multi-provider works;
- multi-account works;
- round-robin works;
- Combo works;
- automatic fallback works;
- quota-aware routing works;
- RTK works;
- Caveman works;
- Ponytail works;
- `/dashboard/usage` has no functional regression;
- `/dashboard/quota` has no functional regression;
- provider management remains available in the UI;
- unused product surfaces are no longer initialized/exposed in the minimal product;
- before/after resource and latency measurements are documented;
- routing hot-path performance is not worse than the current baseline under equivalent test traffic;
- Usage buffering is bounded and shutdown flushing is tested;
- fallback/retry paths are finite and deterministic;
- staging is isolated from production state;
- rollback to the previous production image/version has been tested.

---

## 22. Implementation sequencing

Recommended order:

### Phase 1 — baseline and lock compatibility

- capture current Usage and Quota UI/API behavior;
- create routing fixtures for Combo, round-robin, account fallback, quota states, streaming, tool calls, and all three transports;
- measure startup time, idle RSS, production image/bundle size, and representative streaming latency;
- record a rollback image/reference.

### Phase 2 — extract hot-path runtime state with no behavior change

- cache providers, accounts, aliases, Combos, API-key lookups, quota/cooldown state, and round-robin cursors in memory;
- remove avoidable synchronous SQLite reads from request routing;
- keep SQLite as durable source of truth;
- prove behavior parity before feature removal.

### Phase 3 — strengthen deterministic routing tests

- assert finite fallback/retry bounds;
- cover explicit quota states;
- verify streaming and tool-call behavior;
- make native-vs-translated routing observable in tests.

### Phase 4 — product-surface reduction

- hide or stop initializing one non-retained feature at a time;
- run the full retained regression suite after each removal;
- disable unused background schedulers/services;
- prune dependencies only after runtime references are proven absent.

### Phase 5 — Generic Provider native transports

- define per-provider transport capability schema;
- implement native passthrough preference;
- add Generic Provider UI controls;
- preserve translator fallback for unsupported transports;
- verify unknown-field preservation when transforms are disabled.

### Phase 6 — verify parity, performance, and promotion readiness

- Usage parity suite;
- Quota parity suite;
- routing/fallback suite;
- token-saver suite;
- before/after startup/RSS/image/latency measurements;
- isolated staging smoke tests for active production clients;
- backup and rollback rehearsal before production promotion.

---

## 23. Decision summary

LiteRouter remains a 9Router-derived router because its multi-provider, multi-account, round-robin, Combo, auto-fallback, quota, and token-saving behavior are valuable.

The product is reduced around those strengths rather than replaced.

The intended result is:

```text
LiteRouter

3 native client transports
        +
native passthrough when possible
        +
translation only when necessary
        +
multi-provider / multi-account
        +
round-robin
        +
Combo + auto fallback
        +
quota-aware routing
        +
RTK / Caveman / Ponytail
        +
unchanged Usage
        +
unchanged Quota
        +
small focused admin UI
```
