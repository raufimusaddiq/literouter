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

## Startup

Staging reaches `✓ Ready in 0ms` (Next.js reports the already-compiled server)
and passes its healthcheck within ~30 s of container start (healthcheck
`start_period: 30s`).

## Verified live during this measurement

- All three ingress transports returned HTTP 200 with native passthrough.
- Usage rows written with provider, model, endpoint, tokens, cost, status.
- Retained dashboard pages all return 200 under `MINIMAL_PROFILE=true`.
