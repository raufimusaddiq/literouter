# Mock-mode gateway benchmark

- 2026-11-19T15:11:05.891Z; node v24.15.0; win32 12cpu; gateway `node custom-server.js` (production build), mock upstream on loopback

## a) Gateway overhead (concurrency 1, 200 requests, 20 tokens, mock with no artificial delay)

| run | reqs | failed | req/s | TTFB p50/p99 ms | TTFT p50/p99 ms | total p50/p99 ms | max chunk gap ms |
|---|---|---|---|---|---|---|---|
| direct-nonstream | 200 | 0 | 1907.0 | 0.4 / 1.2 | 0.5 / 1.3 | 0.5 / 1.4 | 0.0 |
| gateway-nonstream | 200 | 0 | 269.9 | 3.2 / 6.1 | 3.5 / 6.5 | 3.5 / 6.5 | 0.0 |
| direct-stream | 200 | 0 | 828.5 | 0.3 / 1.0 | 0.3 / 1.0 | 1.1 / 2.7 | 1.1 |
| gateway-stream | 200 | 0 | 224.4 | 3.3 / 6.4 | 3.4 / 6.5 | 4.2 / 7.5 | 1.8 |

| mode | added total p50 ms | added total p99 ms | added TTFB p50 ms | added TTFB p99 ms | added TTFT p50 ms |
|---|---|---|---|---|---|
| nonstream | 3.0 | 5.2 | 2.8 | 4.8 | 3.0 |
| stream | 3.1 | 4.8 | 3.0 | 5.4 | 3.1 |
Mock upstream saw 800 requests (expected 800: 400 direct + 400 via gateway).

## b) Concurrency sweep (streams of 200 chunks x 20ms = ~4s each, through gateway)

| run | reqs | failed | req/s | TTFB p50/p99 ms | TTFT p50/p99 ms | total p50/p99 ms | max chunk gap ms |
|---|---|---|---|---|---|---|---|
| sweep-c1 | 10 | 0 | 0.2 | 5.1 / 8.3 | 5.2 / 8.4 | 6227.5 / 6245.2 | 133.5 |
| sweep-c10 | 20 | 0 | 1.6 | 32.3 / 43.0 | 32.4 / 43.1 | 6248.2 / 6267.9 | 33.6 |
| sweep-c50 | 100 | 0 | 7.9 | 62.5 / 144.7 | 62.6 / 144.7 | 6271.3 / 6345.9 | 64.6 |
| sweep-c100 | 200 | 0 | 15.7 | 137.5 / 296.9 | 137.5 / 297.0 | 6272.1 / 6486.8 | 106.0 |

Ideal stream wall time is ~4.0s+TTFB; `max chunk gap` > ~100ms means a visible stall.

## c) Soak (600s, concurrency 20 streams, RSS sampled every 10s)

| run | reqs | failed | req/s | TTFB p50/p99 ms | TTFT p50/p99 ms | total p50/p99 ms | max chunk gap ms |
|---|---|---|---|---|---|---|---|
| soak-c20 | 1883 | 0 | 3.1 | 14.7 / 57.6 | 14.8 / 58.5 | 6343.1 / 7193.1 | 956.7 |

- RSS: start 280.8 MB, end 280.5 MB, peak 316.0 MB, 5s after load stopped 280.5 MB
- RSS trend: 2.28 MB/min (least squares); first-third avg 257.4 MB vs last-third avg 279.7 MB
- gateway DATA_DIR files at end (bytes): {"model-catalog.json":368707}; at start: {"model-catalog.json":368707}
- ~/.9router usage files before -> after (bytes): {} -> {}

<details><summary>RSS samples</summary>

| t (s) | RSS MB |
|---|---|
| 0 | 280.8 |
| 10 | 284.0 |
| 20 | 287.1 |
| 30 | 293.4 |
| 40 | 295.9 |
| 50 | 301.3 |
| 60 | 306.9 |
| 70 | 310.3 |
| 80 | 316.0 |
| 90 | 204.2 |
| 100 | 206.1 |
| 110 | 206.5 |
| 120 | 206.5 |
| 130 | 206.0 |
| 140 | 206.1 |
| 150 | 240.8 |
| 160 | 245.6 |
| 170 | 248.8 |
| 180 | 250.9 |
| 190 | 251.3 |
| 200 | 253.6 |
| 210 | 256.0 |
| 220 | 261.5 |
| 230 | 266.6 |
| 240 | 269.5 |
| 250 | 274.8 |
| 260 | 277.1 |
| 270 | 277.1 |
| 280 | 277.2 |
| 290 | 277.3 |
| 300 | 277.4 |
| 310 | 277.3 |
| 320 | 277.3 |
| 330 | 277.6 |
| 340 | 276.1 |
| 350 | 277.2 |
| 360 | 277.9 |
| 370 | 277.5 |
| 380 | 277.9 |
| 390 | 278.0 |
| 400 | 278.0 |
| 410 | 277.6 |
| 420 | 277.7 |
| 430 | 278.7 |
| 440 | 278.8 |
| 450 | 278.8 |
| 460 | 278.3 |
| 470 | 278.5 |
| 480 | 279.7 |
| 490 | 279.8 |
| 500 | 279.8 |
| 510 | 280.0 |
| 520 | 280.0 |
| 530 | 280.8 |
| 540 | 281.2 |
| 550 | 280.4 |
| 560 | 280.7 |
| 570 | 280.8 |
| 580 | 279.7 |
| 590 | 280.4 |
| 600 | 280.5 |
| 606 | 280.5 |

</details>

## d) Client abort (50 streams, each aborted after 1s)

- client: 50 requests, 50 aborted by client, 0 unexpected errors
- mock upstream /_stats before: {"total":2214,"inflight":0,"completed":2214,"aborted":0,"openSockets":1}
- immediately after clients aborted: {"total":2264,"inflight":50,"completed":2214,"aborted":0,"openSockets":52}
- **5s after: {"total":2264,"inflight":0,"completed":2214,"aborted":50,"openSockets":1}** (in-flight must be 0; open sockets are keep-alive pool connections, not requests)
- gateway pending snapshot: n/a

## Interpretation

See the findings below.

### Findings (author notes, Windows 11 / 12 cpu / node 24 / production build, loopback mock)

- **Overhead (a):** the gateway adds ~3 ms p50 / ~5 ms p99 per request for both non-stream and stream, and the same ~3 ms to TTFB/TTFT (c=1, tiny body, no artificial upstream delay). Single-connection throughput through the gateway is ~225-270 req/s vs ~830-1900 direct, i.e. the gateway is the serial bottleneck in a zero-latency upstream setup, not a concern for real LLM latencies (hundreds of ms+).
- **Timer caveat:** on Windows `setTimeout(20)` fires on ~15.6 ms ticks, so the nominal 200 x 20 ms stream takes ~6.2 s (31 ms/chunk), not 4 s. The same wall time is seen at c=1 (6227 ms) and c=100 (6272 ms p50), so the stretch is the mock's timer, not the gateway. Compare rows against each other, not against 4 s.
- **Sweep (b):** 0 errors at 1/10/50/100 concurrent streams. Stream wall time p50 stays 6.23 -> 6.27 s (flat). TTFT p99 grows with concurrency: 8 ms (c1), 43 ms (c10), 145 ms (c50), 297 ms (c100) — the burst of simultaneous request starts is serialised on the single Node event loop (~3 ms CPU per request start), i.e. the connection-ramp bottleneck. Max inter-chunk gap 134 ms at c1 (first-request warmup), 106 ms at c100: no stalls.
- **Soak (c):** 1883 streams, 0 failures, TTFB p99 58 ms. RSS is a GC sawtooth, not a leak: warm-up 281 -> 316 MB, dropped to 204 MB at t=90s, climbed to a plateau of ~277-281 MB from t=270s to t=606s (flat for the last ~5.5 minutes) and equals the start value (281 MB) after load stops. The 2.3 MB/min least-squares slope is dominated by the warm-up/GC cycle. One max chunk gap of 957 ms during the soak (a single GC/event-loop pause or Windows timer hiccup; p99 total 7.2 s vs 6.3 s p50) — worth a longer look on Linux.
- **Usage-DB writes (c):** the SQLite DB lives in `DATA_DIR/db/` (the suite sampler originally looked one level too high; fixed in code afterwards, so the per-sample file sizes above are empty for this run). Final sizes after ~4,300 requests: `data.sqlite` 1.4 MB, `data.sqlite-wal` 3.25 MB (WAL not checkpointed during sustained load; `node:sqlite` driver). Nothing in `~/.9router`. The gateway also logs one stdout line per request (635 KB / 5,290 lines for this run) — a cost to watch if stdout is a slow pipe.
- **Abort (d):** 50 streams aborted by the client after 1 s: upstream had 50 in-flight right after the abort and **0 in-flight / 50 aborted counted by the mock 5 s later**; open sockets back to 1 (the keep-alive pool), so aborts propagate upstream promptly with no leaked connections. The gateway's own pending counter was not read (no stable endpoint found; `gwPending: n/a`); upstream cleanup is the observable proxy. No gateway bug found.
