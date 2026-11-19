# Gateway benchmark

Node built-ins only (no new dependencies). Results go to `bench-results/` (gitignored).

| file | purpose |
|---|---|
| `mock-upstream.mjs` | OpenAI-compatible mock upstream: non-stream + SSE, configurable first-byte delay, chunk count/delay, tokens per chunk; `GET /_stats` exposes in-flight / open sockets |
| `run.mjs` | Load generator against any `/v1` endpoint; TTFB, TTFT, total, tok/s, chunks, status, errors by type; JSON + markdown report |
| `mock-suite.mjs` | Full MOCK run: spawns mocks + the built gateway with a temp `DATA_DIR`, provisions node + API key via the dashboard API, runs sections a-d |
| `stats.mjs` | percentile / summary helpers (unit-tested in `tests/unit/bench-stats.test.js`) |

## REAL mode (a real model through a deployed gateway)

Costs real tokens; defaults are cheap (tiny prompt, `--max-tokens 128`). The key is read from the
environment and is never printed or written to the report.

```bash
LITEROUTER_BENCH_KEY=... node scripts/bench/run.mjs --base-url https://ai.musaddiqr.com/v1 --model hy4-flash --mode stream --concurrency 1 --requests 20 --max-tokens 128 --label real-hy4flash-c1
```

Concurrency 5 variant:

```bash
LITEROUTER_BENCH_KEY=... node scripts/bench/run.mjs --base-url https://ai.musaddiqr.com/v1 --model hy4-flash --mode stream --concurrency 5 --requests 30 --max-tokens 128 --label real-hy4flash-c5
```

Flags: `--base-url`, `--key` (or `LITEROUTER_BENCH_KEY`), `--model`, `--mode stream|nonstream`,
`--concurrency`, `--requests N` or `--duration SECONDS`, `--prompt-size` (approx tokens),
`--max-tokens`, `--abort-after-ms`, `--timeout-ms`, `--label`, `--out-dir`, `--no-write`.
Exit code is 1 if any request failed, 2 if no key. Client-aborted requests (`--abort-after-ms`) are ignored by the exit code by design.

## MOCK mode (gateway's own overhead, free)

```bash
npm run build
node scripts/bench/mock-suite.mjs                       # ~15 min, includes a 10 min soak
node scripts/bench/mock-suite.mjs --only a,b,d          # skip the soak
node scripts/bench/mock-suite.mjs --soak-seconds 60     # shorter soak
```

Sections: **a)** direct-to-mock vs through-gateway at c=1 (added latency); **b)** concurrency
sweep 1/10/50/100 streams of 200 chunks x 20ms; **c)** soak at c=20 with RSS sampled every 10s
(OS-level RSS of the gateway PID via `tasklist` / `/proc`); **d)** 50 streams aborted after 1s,
then the mock's in-flight count is checked 5s later. Output: `bench-results/<ts>-mock.{md,json}`. Committed baselines: `baseline-mock-report.md` (before the gateway audit) and `after-gateway-audit-report.md` (after T-33..T-41, with a before/after comparison).

Ports (override with flags `--gw-port`, `--mock-fast-port`, `--mock-slow-port`): gateway 20190,
mocks 9101 / 9102. The suite logs into the dashboard with a throwaway password over loopback
(it needs `node custom-server.js`, not `next dev`, so loopback is trusted).

Notes: on Windows `setTimeout` is quantised to ~15ms, so the mock replies inline when a delay is 0;
the 20ms chunk-delay streams are therefore coarse (~31ms/chunk on Windows) - compare gateway vs
direct, not against the nominal delay.
