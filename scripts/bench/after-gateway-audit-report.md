# Mock-mode gateway benchmark: after gateway audit (T-33..T-41)

Run on main `9eecc706` (2026-11-20), same machine/OS/node as the baseline (`baseline-mock-report.md`): win32 12cpu, node v24.15.0.

## Comparison with baseline

| Measure | Baseline | After | Note |
|---|---|---|---|
| Added latency per request p50/p99 (stream) | 3.1 / 4.8 ms | 2.8 / 5.6 ms | unchanged (~3 ms) |
| c100 TTFT p50/p99 | 137.5 / 297.0 ms | 122.0 / 256.5 ms | slightly better |
| c100 max chunk gap | 106.0 ms | 92.2 ms | slightly better |
| Soak max chunk gap | 956.7 ms | 154.9 ms | 6x better |
| Soak total p99 | 7193.1 ms | 6353.7 ms | better |
| Soak TTFB p99 | 57.6 ms | 44.0 ms | better |
| Soak streams/failures | 1883 / 0 | 1920 / 0 | no failures |
| RSS start -> end | 280.8 -> 280.5 MB | 281.5 -> 259.4 MB | trend -1.8 MB/min, no leak |
| Abort: upstream in-flight 5s after | 0 | 0 | no leaked upstream connections |

- 2026-11-19T17:46:55.340Z; node v24.15.0; win32 12cpu; gateway `node custom-server.js` (production build), mock upstream on loopback

## a) Gateway overhead (concurrency 1, 200 requests, 20 tokens, mock with no artificial delay)

| run | reqs | failed | req/s | TTFB p50/p99 ms | TTFT p50/p99 ms | total p50/p99 ms | max chunk gap ms |
|---|---|---|---|---|---|---|---|
| direct-nonstream | 200 | 0 | 2017.6 | 0.4 / 1.3 | 0.4 / 1.4 | 0.5 / 1.4 | 0.0 |
| gateway-nonstream | 200 | 0 | 254.8 | 3.4 / 7.4 | 3.6 / 7.9 | 3.6 / 7.9 | 0.0 |
| direct-stream | 200 | 0 | 896.8 | 0.3 / 0.8 | 0.3 / 0.9 | 1.0 / 2.4 | 1.2 |
| gateway-stream | 200 | 0 | 240.6 | 3.0 / 6.4 | 3.0 / 6.5 | 3.8 / 8.1 | 1.9 |

| mode | added total p50 ms | added total p99 ms | added TTFB p50 ms | added TTFB p99 ms | added TTFT p50 ms |
|---|---|---|---|---|---|
| nonstream | 3.2 | 6.5 | 3.0 | 6.1 | 3.2 |
| stream | 2.8 | 5.6 | 2.7 | 5.6 | 2.7 |
Mock upstream saw 800 requests (expected 800: 400 direct + 400 via gateway).

## b) Concurrency sweep (streams of 200 chunks x 20ms = ~4s each, through gateway)

| run | reqs | failed | req/s | TTFB p50/p99 ms | TTFT p50/p99 ms | total p50/p99 ms | max chunk gap ms |
|---|---|---|---|---|---|---|---|
| sweep-c1 | 10 | 0 | 0.2 | 5.0 / 6.7 | 5.0 / 6.8 | 6223.4 / 6237.6 | 108.3 |
| sweep-c10 | 20 | 0 | 1.6 | 27.6 / 37.2 | 27.7 / 37.2 | 6247.4 / 6252.5 | 32.7 |
| sweep-c50 | 100 | 0 | 7.9 | 81.8 / 128.5 | 81.9 / 128.5 | 6260.2 / 6354.8 | 83.5 |
| sweep-c100 | 200 | 0 | 15.7 | 122.0 / 256.5 | 122.0 / 256.5 | 6283.4 / 6486.3 | 92.2 |

Ideal stream wall time is ~4.0s+TTFB; `max chunk gap` > ~100ms means a visible stall.

## c) Soak (600s, concurrency 20 streams, RSS sampled every 10s)

| run | reqs | failed | req/s | TTFB p50/p99 ms | TTFT p50/p99 ms | total p50/p99 ms | max chunk gap ms |
|---|---|---|---|---|---|---|---|
| soak-c20 | 1920 | 0 | 3.2 | 12.2 / 44.0 | 12.3 / 44.0 | 6269.0 / 6353.7 | 154.9 |

- RSS: start 281.5 MB, end 259.4 MB, peak 321.2 MB, 5s after load stopped 259.4 MB
- RSS trend: -1.80 MB/min (least squares); first-third avg 263.8 MB vs last-third avg 256.7 MB
- gateway DATA_DIR files at end (bytes): {"data.sqlite":1220608,"data.sqlite-shm":32768,"data.sqlite-wal":2307232}; at start: {"data.sqlite":425984,"data.sqlite-shm":32768,"data.sqlite-wal":2200112}
- ~/.9router usage files before -> after (bytes): {} -> {}

<details><summary>RSS samples</summary>

| t (s) | RSS MB |
|---|---|
| 0 | 281.5 |
| 10 | 284.9 |
| 20 | 288.3 |
| 30 | 293.0 |
| 40 | 296.4 |
| 50 | 302.0 |
| 60 | 308.9 |
| 70 | 311.2 |
| 80 | 316.9 |
| 90 | 321.2 |
| 100 | 204.8 |
| 110 | 213.5 |
| 120 | 212.8 |
| 130 | 213.6 |
| 140 | 213.3 |
| 150 | 213.3 |
| 160 | 248.6 |
| 170 | 250.0 |
| 180 | 250.0 |
| 190 | 250.8 |
| 200 | 253.7 |
| 210 | 258.5 |
| 220 | 262.4 |
| 230 | 268.0 |
| 240 | 271.8 |
| 250 | 277.4 |
| 260 | 282.8 |
| 270 | 188.4 |
| 280 | 191.3 |
| 290 | 195.6 |
| 300 | 196.6 |
| 310 | 199.3 |
| 320 | 200.8 |
| 330 | 247.5 |
| 340 | 248.4 |
| 350 | 248.4 |
| 360 | 250.3 |
| 370 | 250.8 |
| 380 | 249.7 |
| 390 | 250.6 |
| 400 | 252.5 |
| 410 | 253.5 |
| 420 | 253.8 |
| 430 | 253.7 |
| 440 | 254.4 |
| 450 | 254.6 |
| 460 | 254.8 |
| 470 | 254.3 |
| 480 | 255.4 |
| 490 | 255.7 |
| 500 | 256.1 |
| 510 | 256.9 |
| 520 | 257.3 |
| 530 | 257.3 |
| 540 | 257.0 |
| 550 | 257.9 |
| 560 | 258.1 |
| 570 | 258.0 |
| 580 | 259.6 |
| 590 | 259.6 |
| 600 | 259.4 |
| 603 | 259.4 |

</details>

## d) Client abort (50 streams, each aborted after 1s)

- client: 50 requests, 50 aborted by client, 0 unexpected errors
- mock upstream /_stats before: {"total":2251,"inflight":0,"completed":2251,"aborted":0,"openSockets":1}
- immediately after clients aborted: {"total":2301,"inflight":50,"completed":2251,"aborted":0,"openSockets":51}
- **5s after: {"total":2301,"inflight":0,"completed":2251,"aborted":50,"openSockets":1}** (in-flight must be 0; open sockets are keep-alive pool connections, not requests)
- gateway pending snapshot: n/a

## Interpretation

- Per-request overhead is unchanged (~3 ms added p50, ~5 ms p99).
- Sustained-load stalls are fixed: the synchronous request-detail flush and usage aggregate writes were removed by T-37/T-38 (soak max chunk gap 957 -> 155 ms).
- Memory is stable: RSS ends below its start and trends -1.8 MB/min over the soak.
