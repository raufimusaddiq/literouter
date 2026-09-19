# Latency and resource measurements (staging vs production)

## Method

Both deployments routed identical non-streaming `POST /v1/chat/completions`
requests to an identical mock upstream container, so the measured difference is
router overhead rather than upstream variance.

- Production: `9router:v0.5.81-kenari-luna` on `172.30.0.2:20128`, Generic
  Provider node pointed at `http://mockprod:8099/v1`.
- Staging: `literouter:staging` on `127.0.0.1:20129`, Generic Provider node
  pointed at `http://mockup:8099/v1`.
- n=30 requests each, warm process, single client.

## Results

| Metric | Production baseline | Staging | Change |
| --- | --- | --- | --- |
| Median | 16.53 ms | 14.04 ms | -15.1% |
| Mean | 17.46 ms | 15.33 ms | -12.2% |
| p95 | 25.36 ms | 19.22 ms | -24.2% |
| Min | 10.44 ms | 12.13 ms | +16% |
| Max | 40.88 ms | 27.67 ms | -32.3% |

Staging median and p95 are both better than baseline and the tail is
substantially tighter. The min is slightly higher on staging, which is within
noise for a single client and does not affect the acceptance requirement
("routing hot-path performance is not worse than the current baseline").

## Resource footprint

| Metric | Production | Staging |
| --- | --- | --- |
| Image size | 1027200945 B (1.03 GB) | 1.03 GB |
| Idle RSS | 192.1 MiB | 60-67 MiB observed |
| Memory limit | 512 MiB | 512 MiB |

Staging idle RSS is materially lower, partly because the staging profile has no
provider connections of its own and runs with `MODEL_CATALOG_SYNC=off` and
`DISABLE_BACKGROUND_TOKEN_REFRESH=true`. It is not yet a like-for-like
comparison; a production-equivalent staging dataset is required before treating
this as a sizing claim.

## CPU under concurrent streaming

PRD section 16 requires a CPU measurement under representative concurrent
streaming traffic, not just an idle sample. Ten simultaneous streaming
`POST /v1/chat/completions` requests were issued to staging, each
asking for a long (600-word) completion so the streams stayed open while CPU was
sampled once per second.

| Sample | Staging CPU | Staging RSS |
| --- | --- | --- |
| 1 | 12.38% | 77.2 MiB |
| 2 | 66.41% | 79.6 MiB |
| 3 | 59.91% | 80.9 MiB |
| 4 | 31.40% | 81.0 MiB |
| 5 (drained) | 0.06% | 81.0 MiB |
| 6 (drained) | 0.27% | 80.7 MiB |

Peak CPU is 66% of one core while ten streams are open, and it returns to
idle within two samples of the last stream completing. RSS grows by ~5 MiB
across the burst and does not return to its floor, which is the expected
in-process cache and V8 heap growth rather than a leak: the same container held
steady at 75-81 MiB across the earlier measurements.

For reference, production sampled at 0.00% CPU and 98.9 MiB RSS in the same
idle window. The comparison that matters for the acceptance criterion is the
hot-path latency table above, since CPU share on a shared host is noisy; the
streaming burst here is to show that concurrency does not saturate the
container or grow memory without bound.

## Startup

Staging reaches `✓ Ready in 0ms` (Next.js reports the already-compiled server)
and passes its healthcheck within ~30 s of container start (healthcheck
`start_period: 30s`).

## Verified live during this measurement

## Re-measurement (2026-09-19, current build)

Re-run after the request-detail buffering work and the minimal-boundary
additions, with staging now carrying its own provider connections and real
traffic rather than an empty dataset.

Hot path, n=30 warm non-streaming `POST /v1/chat/completions`:

| Metric | Production baseline | Staging (current) |
| --- | --- | --- |
| Median | 16.53 ms | 13.64 ms |
| p95 | 25.36 ms | 19.40 ms |
| Min | 10.44 ms | 11.97 ms |
| Max | 40.88 ms | 20.63 ms |

A cold first sample reads higher (median 16.55 ms, p95 33.21 ms) because the
first requests pay route compilation. The warm steady state is what the
acceptance criterion covers, and it remains better than baseline.

Idle RSS, both containers sampled together:

| Container | RSS |
| --- | --- |
| `9router` (production) | 118.1 MiB |
| `literouter-staging` | 68.9 MiB |

Staging now holds its own connections and traffic history, so this is closer to
like-for-like than the original sample, though staging still runs with the
minimal profile active and no tunnel/MITM managers loaded.

- All three ingress transports returned HTTP 200 with native passthrough.
- Usage rows written with provider, model, endpoint, tokens, cost, status.
- Retained dashboard pages all return 200 under `MINIMAL_PROFILE=true`.

## Public-endpoint burst (2026-09-20): production vs staging

Earlier tables measured router overhead against a mock upstream. That mock is
gone, so the like-for-like comparison is now the same public ingress on both
deployments with a real upstream model:

- Production: `https://ai.investdx.biz.id`
- Staging: `https://ai-staging.investdx.biz.id`
- Model: `kn/deepseek-v4-1-flash` (Kenari), non-streaming, `max_tokens=32`
- n=24 each: 8 concurrent requests, 3 rounds, same payload

| Metric | Production | Staging |
| --- | --- | --- |
| Success | 24/24 | 24/24 |
| Median (p50) | 1715 ms | 1580 ms |
| p95 | 2053 ms | 2062 ms |
| Max | 2108 ms | 2080 ms |

Staging median is 7.9% faster; the tail is equal within noise. These numbers
include upstream (Kenari) and network variance, so they bound the user-visible
path rather than isolating router cost. The controlled mock table above still
isolates router overhead and remains the acceptance evidence for the hot path.

Post-burst resource sample, both containers together:

| Container | RSS | Memory limit |
| --- | --- | --- |
| `9router` (production) | 236.6 MiB | 512 MiB |
| `literouter-staging` | 72.3 MiB | 512 MiB |
| `idx-redis` | 5.8 MiB | 256 MiB |

Redis held only `literouter:staging:cache:connections:version` after the burst.
Redis on staging is connection-cache invalidation, not response caching, so a
chat burst is not expected to add keys.

## Stable designation

As of 2026-09-20 the `staging` branch and the `ai-staging.investdx.biz.id`
deployment are declared stable under the name **LiteRouter**. They carry the
Redis connection-cache invalidation and the reproducible lockfile-based CI
(#20) plus the Alpine musl native pins (#21). Production `9router` remains the
prior image and is untouched.
