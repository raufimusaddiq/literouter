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

Existing adapters may be retained when they provide real compatibility value.

They should not all perform work at startup. Provider-specific code should be lazy-loaded where practical.

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

The UI and runtime must continue supporting the routing strategies actively provided by the current Combo implementation, especially:

- ordered fallback,
- round-robin/pool behavior,
- automatic progression to another candidate after eligible failures.

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
- remove provider,
- OAuth connection where retained,
- API-key connection,
- Generic Provider,
- account state,
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

### 15.1 Default architecture: in-memory + SQLite

The default single-instance deployment should use:

```text
                    LiteRouter process
                           |
              +------------+-------------+
              |                          |
              v                          v
      in-memory hot state             SQLite
      -------------------             ------
      providers                       durable config
      accounts                        credentials metadata
      combos                          provider/account config
      aliases                         combo definitions
      API-key lookup                  aliases/settings
      quota/cooldown                  complete Usage history
      health state                    quota snapshots where needed
      RR cursors                      migrations
      transport caps
```

SQLite is the durable source of truth. In-memory state is the request-path cache.

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

### 15.3 Redis is optional, not a default dependency

Redis MAY be supported as an optional shared runtime-state backend, but LiteRouter minimal MUST NOT require Redis for the normal single-instance deployment.

Redis becomes justified when one or more of these are true:

- LiteRouter runs multiple replicas/processes that must coordinate routing state;
- round-robin cursors must be shared across replicas;
- cooldown/rate-limit/quota state must be shared immediately across replicas;
- distributed locks are required for OAuth refresh or other singleton work;
- high-volume counters need shared atomic increments;
- a deployment explicitly requires shared ephemeral cache/state.

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

Redis must not become the sole durable source for provider, combo, Usage, or other configuration/history that must survive cache loss.

### 15.4 Cache ownership

Recommended ownership:

| State | Single instance | Multi-instance |
| --- | --- | --- |
| Provider/account config | memory, sourced from SQLite | local memory + invalidation/versioning |
| Combo definitions | memory, sourced from SQLite | local memory + invalidation/versioning |
| Model aliases | memory, sourced from SQLite | local memory + invalidation/versioning |
| API-key lookup | memory, sourced from SQLite | local memory + invalidation/versioning |
| Transport capabilities | memory | local memory; durable definition in SQLite |
| Quota/cooldown | memory + persistence where needed | Redis/shared state where correctness requires it |
| Health state | memory | Redis optional/shared when needed |
| Round-robin cursor | memory | Redis atomic counter when global RR is required |
| OAuth refresh lock | local mutex | Redis/distributed lock if multiple replicas can refresh the same credential |
| Usage history | SQLite/durable storage | durable storage; Redis only as optional buffering/counter layer |
| UI session/cache | memory where safe | Redis optional |

### 15.5 Cache invalidation requirements

Cache correctness is more important than maximizing cache hit rate.

When Providers, Combos, aliases, API keys, or routing settings change through the UI:

1. write/commit the durable change;
2. invalidate or replace the corresponding in-memory object;
3. new requests must see the new configuration immediately after successful mutation;
4. stale cache must never require a process restart to clear.

If Redis is enabled for multi-instance operation, configuration changes must propagate through a lightweight version/pub-sub invalidation mechanism or equivalent.

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

Redis may optionally act as a queue/counter buffer in a distributed deployment, but is not required for the default architecture.

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
- must be shared atomically across multiple LiteRouter replicas,
- benefits from TTL, distributed locks, pub/sub, or atomic counters.

For the expected initial LiteRouter deployment, the recommended default is:

```text
in-memory hot cache + SQLite persistence
```

not:

```text
Redis + SQLite
```

Redis should be introduced only after there is a concrete multi-instance/shared-state requirement or measurements show a real bottleneck that Redis solves.

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
- OAuth/token refresh for retained providers,
- API-key providers,
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
- routing hot-path performance is not worse than the current baseline under equivalent test traffic.

---

## 22. Implementation sequencing

Recommended order:

### Phase 1 — lock compatibility

- create regression tests for Usage, Quota, Combo, and all three transports;
- measure current runtime/resource baseline;
- define provider transport capability schema.

### Phase 2 — native transport routing

- implement per-provider transport capabilities;
- implement native passthrough preference;
- add Generic Provider UI controls;
- keep translator as fallback.

### Phase 3 — remove hot-path overhead

- cache routing state;
- remove avoidable synchronous storage access;
- make usage persistence non-blocking where behavior can remain identical;
- lazy-load provider adapters.

### Phase 4 — product-surface reduction

- remove/hide non-goal dashboard pages;
- disable unused background schedulers/services;
- prune dependencies proven unused.

### Phase 5 — verify parity and performance

- Usage parity suite;
- Quota parity suite;
- routing/fallback suite;
- token-saver suite;
- before/after performance report.

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
