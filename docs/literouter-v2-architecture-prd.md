# LiteRouter v2 Core Architecture Rewrite PRD

Status: Proposed
Target branch: main
Source baseline: main at dc28cdf82c763fbe975188e4291df1f97bde9cec
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

The following are release-blocking until explicitly superseded by another approved PRD.

### 5.1 Public inference contracts

Preserve:

- POST /v1/chat/completions
- POST /v1/responses
- POST /v1/messages
- POST /v1/systemone where currently supported
- current model identifiers and aliases
- current API-key behavior for remote callers
- expected streaming termination semantics
- client disconnect/cancellation behavior
- response status and error shape where clients depend on it

### 5.2 Routing behavior

Preserve:

- multi-provider routing;
- multiple accounts per provider;
- fill-first behavior;
- round-robin behavior;
- sticky round-robin behavior;
- account exclusion during retries;
- bounded account fallback;
- model-level cooldown/lock behavior;
- provider-specific exact reset times where available;
- Combo ordered fallback;
- Combo round-robin/sticky behavior;
- Fusion while it remains a retained feature;
- capability-adapter behavior while it remains a retained feature;
- Generic Provider/custom provider nodes;
- proxy-pool binding where configured;
- no-auth/free providers.

### 5.3 Retained transforms and features

Before implementation, create a compatibility inventory for:

- RTK/token saver;
- Caveman;
- Ponytail;
- PXPipe if reachable by retained configuration;
- Headroom if reachable by retained configuration;
- provider thinking controls;
- request bypass/warmup behavior;
- source-format detection;
- provider-specific token refresh.

A feature may only be omitted from v2 after a separate explicit decision documents that it is no longer part of the LiteRouter product contract.

### 5.4 Durable state

The migration must preserve, where present:

- settings;
- API keys;
- provider connections;
- provider credentials;
- provider nodes;
- proxy pools;
- combos;
- model aliases;
- custom models;
- pricing;
- disabled models;
- Usage history;
- request details;
- quota-relevant state that is currently durable;
- schema migration version.

No production migration may require manually editing SQLite rows.

### 5.5 Security behavior

The rewrite must preserve or strengthen:

- remote API-key enforcement;
- dashboard authentication;
- local/operator trust boundaries;
- protection from spoofed forwarding headers;
- outbound SSRF protection for user-configurable provider URLs;
- metadata/private-network blocking rules where applicable;
- credential redaction;
- request-log header sanitization;
- constant-time or equivalently safe API-key comparison;
- secrets staying server-side;
- provider validation using the same outbound-network policy as inference.

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

Fusion remains a distinct execution mode because it can intentionally fan out requests. It must not be hidden inside normal fallback logic.

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

## 17. Detailed migration plan

The rewrite is a strangler migration. No big-bang replacement.

### Phase 0 - contract freeze and benchmark harness

Deliverables:

- compatibility inventory of all retained ingress/provider/features;
- golden fixtures for representative requests/responses;
- mock upstreams for OpenAI, Responses, Anthropic, System One;
- existing Node output captured for deterministic cases;
- benchmark harness that can target Node and Go with identical payloads;
- explicit current-main baseline report.

Required before Go owns production traffic.

### Phase 1 - Go skeleton and persistence compatibility

Deliverables:

- cmd/literouter process;
- config/environment loading;
- health/readiness endpoints;
- read-only access to a copy of current SQLite data;
- schema/version validation;
- runtime snapshot compiler;
- static route/model/provider indexes;
- no production routing yet.

Gate:

- can load a production-copy database without mutation;
- snapshot build is deterministic;
- secrets never appear in debug output.

### Phase 2 - native inference core

Implement in this order unless compatibility evidence requires a different sequence:

1. generic OpenAI-compatible native path;
2. OpenAI Responses native path;
3. Anthropic Messages native path;
4. System One native path;
5. provider/account selection;
6. cooldown/fallback;
7. aliases/custom provider nodes;
8. Combo;
9. retained transforms;
10. provider-specific OAuth/token/quota adapters.

Gate each family independently with contract tests.

### Phase 3 - telemetry and observability

Deliver:

- request lifecycle events;
- bounded telemetry queue;
- batched Usage persistence;
- request-detail persistence;
- live event stream;
- metrics for queue depth/drop count, active requests, route mode, upstream timings.

Do not cut traffic until Usage parity is proven.

### Phase 4 - shadow/replay verification

Preferred verification methods, in order of safety:

1. replay sanitized captured request fixtures offline;
2. send deterministic requests to mock upstreams through both implementations;
3. for safe idempotent/controlled upstream tests, compare live behavior.

Do not duplicate arbitrary production model requests to paid upstreams merely for shadowing.

Compare:

- status;
- headers required by clients;
- first event;
- event sequence;
- terminal event;
- error classification;
- selected route/account where deterministic;
- Usage record;
- request-detail record.

### Phase 5 - inference cutover

Run Node dashboard/control plane and Go data plane side by side.

Caddy routing:

~~~text
/v1/chat/completions -> Go
/v1/responses        -> Go
/v1/messages         -> Go
/v1/systemone        -> Go
/dashboard/*         -> Node
/api/*               -> Node
~~~

Prefer one durable writer for overlapping data categories. The exact ownership of SQLite writes during this phase must be documented before cutover.

If both processes need the same SQLite file, do not assume WAL makes dual application writers safe enough. Define ownership per table or introduce an explicit bridge. A safer initial cutover is for Go to own inference telemetry writes while Node remains control-plane writer, with both behaviors rehearsed against a copy of production data.

Rollback:

- Caddy routes inference back to Node;
- stop Go writer before rollback if required by the data-ownership model;
- verify health and representative route.

### Phase 6 - Go control-plane API

Port mutations/read APIs to Go.

Order:

1. overview/read models;
2. providers/provider nodes;
3. keys/settings;
4. combos;
5. Usage/request details;
6. quota;
7. token-saver settings;
8. System One workspace APIs;
9. remaining retained operator functions.

Node pages may call Go admin APIs during this transition if CORS/same-origin routing remains simple.

### Phase 7 - static dashboard

Build new Vite/React UI against /admin/v1.

Port workflows page by page. Do not combine this with another visual redesign unless separately scoped.

Gate:

- critical operator workflows are feature-complete;
- no production-only Next API dependency remains;
- cold navigation and interaction performance are measured.

### Phase 8 - Node/Next removal

Only after all gates:

- remove Next production runtime;
- remove custom-server.js;
- remove Node inference modules;
- remove obsolete /api compatibility routes after deprecation window;
- remove Redis from default compose if no retained runtime function needs it;
- shrink production Docker image;
- update README and operational docs;
- retain migration/rollback tooling for at least one release window.

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

Recommended PR sequence:

1. docs: approve v2 architecture PRD;
2. test: add compatibility fixtures and differential harness without changing runtime;
3. feat(v2): add Go skeleton, health, SQLite read compatibility, snapshot compiler;
4. feat(v2): add generic OpenAI native route;
5. feat(v2): add Responses and Anthropic native routes;
6. feat(v2): add routing/account/cooldown/fallback;
7. feat(v2): add Combo/custom nodes/aliases;
8. feat(v2): port provider-specific adapters and retained transforms in reviewable groups;
9. feat(v2): add telemetry/Usage/request-details parity;
10. ops(v2): add side-by-side container and Caddy routing support, disabled by default;
11. perf(v2): publish Node-vs-Go benchmark evidence;
12. release(v2): cut inference paths to Go after review gates;
13. feat(v2-control): add /admin/v1 API;
14. feat(v2-ui): add static UI shell and overview;
15. feat(v2-ui): port remaining dashboard workflows in bounded PRs;
16. release(v2): remove Node from production path;
17. cleanup(v2): remove obsolete Node/Next runtime only after rollback window.

Each implementation PR must state:

- what compatibility surface moved;
- which Node behavior remains authoritative;
- differential test result;
- rollback impact;
- benchmark impact when the hot path changes.

## 26. Review and merge discipline

Because this project uses automated review and a serialized review queue, v2 work should avoid stacking many dependent PR heads awaiting review.

Preferred discipline:

- one active implementation PR per dependency chain;
- keep changes reviewable and independently testable;
- after review findings, bundle related fixes into one push rather than repeatedly pushing tiny fix commits;
- do not delete old runtime code in the same PR that introduces an unproven replacement;
- only remove compatibility code after the replacement has run in production and rollback criteria are satisfied.

## 27. Cutover gates

Inference cutover requires all of:

- contract suite green;
- differential suite green;
- security suite green;
- existing retained Node regression suite green;
- production-copy SQLite load succeeds;
- Usage parity succeeds;
- streaming cancellation succeeds;
- controlled p50/p95 not worse than main;
- concurrent streaming CPU/RSS acceptable;
- rollback rehearsal succeeds;
- reviewer blockers resolved.

Node removal requires additional gates:

- Go admin API feature parity;
- static dashboard critical workflow parity;
- no required production Next API routes;
- no provider credential exposed to browser;
- production stable observation period completed;
- rollback artifact retained.

## 28. Rollback plan

### During data-plane-only cutover

Rollback must be an edge-route change plus writer ownership handoff if necessary.

Procedure:

1. stop or quiesce the Go writer according to the phase's SQLite ownership model;
2. route /v1 paths back to the known-good Node container;
3. verify health;
4. run representative native + streaming request;
5. verify Usage is still appendable;
6. preserve failed Go logs and snapshot version for debugging.

### After Node removal

Keep one immutable pre-removal Node image and compatible database backup for the agreed rollback window.

If v2 introduces a forward-only schema migration, Node removal is blocked until a tested reverse migration or compatibility path exists.

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

### Risk: SQLite dual-writer transition

Mitigation:
- define table/write ownership;
- prefer one writer per category;
- rehearse with production-copy volume;
- no casual assumption that WAL alone solves application-level coordination.

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

These do not block approval of the architectural direction, but each must be resolved before the affected implementation phase:

- exact Go router/HTTP library: standard net/http is the default unless benchmark evidence justifies another dependency;
- exact SQLite driver after evaluating CGO/static-image implications;
- whether the static UI is Caddy-served or embedded;
- precise critical-telemetry durability/overflow policy;
- schema additions needed to separate durable locks from configuration;
- exact Caddy side-by-side cutover topology;
- retained status of PXPipe/Headroom if they are still reachable only through legacy configuration;
- browser-performance budget values after capturing a reproducible current-production baseline.

## 32. Definition of done

LiteRouter v2 is complete only when:

- all retained public inference contracts are served by Go;
- all retained provider/account/Combo behavior passes compatibility tests;
- Usage, request details, quota, keys, providers, settings, and operator workflows are served without the Node runtime;
- static React dashboard is the production control plane;
- steady-state inference performs no synchronous SQLite/Redis lookup for configuration;
- native streaming does not perform unnecessary protocol re-encoding;
- telemetry is asynchronous and bounded;
- existing production data has migrated without manual row editing;
- production image no longer requires Next/Node;
- benchmark report demonstrates no regression against the approved main baseline;
- rollback has been rehearsed;
- obsolete Node/Next paths have been removed only after the rollback window.

At that point LiteRouter is no longer architecturally "9Router with fewer surfaces." It is a LiteRouter-owned routing system with compatibility to the public behavior that matters.
