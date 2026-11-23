#!/usr/bin/env bun
import fs from "node:fs";
const USAGE = `Cutover perf measurement.
Pre-release perf measurement (run on a quiet host; alternate the baseline and candidate images, 3 rounds each).
The baseline is the image of the current release and the candidate is the image to ship; both are Bun images.
  BASE_IMG=ghcr.io/raufimusaddiq/literouter-production:<current-release-tag>
  CAND_IMG=ghcr.io/raufimusaddiq/literouter-staging:<candidate-tag>
  1. Seed one data dir once (peer is never loopback in a container, so no dashboard API):
       KEY=$(bun tests/server/helpers/seed.mjs <seedDir> --upstream http://<host>:9101 --print-key | tail -1)
     <host> is host.docker.internal where Docker maps it to the machine. On the dev box smoke it
     resolved to the bridge and refused, so use an address a container can reach (e.g. 172.24.0.1).
     Do not pass --add-host host.docker.internal:host-gateway: it overrides Docker's own mapping.
     Per round copy the seed fresh (cp -r <seedDir> <roundDir>): the gateway writes account lock state into it.
  2. Per round, for each image:
       docker run -d --name p5-round --memory 768m --cpus 2 \
         -p <port>:20128 -v <roundDir>:/app/data <image>
     Both images use --memory 768m --cpus 2, the same seed copy and the same host mock.
  3. bun scripts/cutover/measure.mjs <container> http://127.0.0.1:<port>/v1 "$KEY" <model> round-N-base.json
     The script starts the host mock itself on 0.0.0.0:9101 (chunks 200); do not start another.
     Remove the container, then repeat for the other image. Take the median per metric over 3 rounds.
  4. Median per metric over the rounds:
       bun scripts/cutover/perf-gate.mjs --median round-1-base.json round-2-base.json round-3-base.json > base.json
       bun scripts/cutover/perf-gate.mjs --median round-1-cand.json round-2-cand.json round-3-cand.json > cand.json
  5. Image size, ONLY AFTER all measurement rounds: it pulls both arches under the same tag (arm64 first, amd64 last,
     so the local tag ends on amd64; arm64 is never run) and writes imageBytes into the JSON:
       bun scripts/cutover/measure.mjs --image $CAND_IMG cand.json
  6. bun scripts/cutover/perf-gate.mjs base.json cand.json
The key is only used for requests and is never written to the output file.

usage: bun scripts/cutover/measure.mjs <container> <baseUrl> <key> <model> <out.json>
       bun scripts/cutover/measure.mjs --image <imageRef> <out.json>
`;
import { runBench } from "../bench/run.mjs";
import { percentile } from "../bench/stats.mjs";
import { startMock } from "../bench/mock-upstream.mjs";

const IDLE_WAIT_MS = 60_000;
const READ_GAP_MS = 10_000;
const SETTLE_MS = 30_000;
const MOCK_PORT = 9101;
const ARCHES = ["arm64", "amd64"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => percentile(xs, 50);

function docker(args) {
  const run = Bun.spawnSync(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`docker ${args.join(" ")} failed: ${run.stderr.toString().trim()}`);
  return run.stdout.toString();
}

export function parseVmRssMiB(status) {
  const m = /^VmRSS:\s+(\d+)\s*kB/m.exec(status);
  if (!m) throw new Error("VmRSS not found in /proc/1/status");
  return Number(m[1]) / 1024;
}

const readRss = (container) => parseVmRssMiB(docker(["exec", container, "cat", "/proc/1/status"]));

async function waitHealthy(baseUrl, timeoutMs = 120_000) {
  const origin = new URL(baseUrl).origin;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/api/health`)).status === 200) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error(`${origin}/api/health not healthy within ${timeoutMs / 1000}s`);
}

export function imageSizes(ref) {
  const out = {};
  for (const arch of ARCHES) {
    docker(["pull", "--platform", `linux/${arch}`, ref]);
    out[arch] = Number(docker(["image", "inspect", "--format", "{{.Size}}", ref]).trim());
  }
  return out;
}

async function measure([container, baseUrl, key, model, outPath]) {
  const mock = await startMock({ host: "0.0.0.0", port: MOCK_PORT, chunks: 200, chunkDelayMs: 0 });
  try {
    await waitHealthy(baseUrl);
    await sleep(IDLE_WAIT_MS);
    const idle = [];
    for (let i = 0; i < 3; i++) {
      if (i > 0) await sleep(READ_GAP_MS);
      idle.push(readRss(container));
    }
    const burst = await runBench({ baseUrl, key, model, mode: "stream", concurrency: 20, requests: 400, maxTokens: 200, label: "perf-burst" });
    if (burst.report.failed > 0) throw new Error(`burst had failures: ${JSON.stringify(burst.report.errors)}`);
    await sleep(SETTLE_MS);
    const rssPostBurstMiB = readRss(container);
    const lat = await runBench({ baseUrl, key, model, mode: "nonstream", concurrency: 1, requests: 300, label: "perf-latency" });
    if (lat.report.failed > 0) throw new Error(`latency run had failures: ${JSON.stringify(lat.report.errors)}`);
    const totals = lat.results.map((r) => r.totalMs);
    const measure = {
      rssIdleMiB: median(idle),
      rssPostBurstMiB,
      p50Ms: percentile(totals, 50),
      p95Ms: percentile(totals, 95),
    };
    fs.writeFileSync(outPath, JSON.stringify(measure, null, 2) + "\n");
    console.log(JSON.stringify(measure));
  } finally {
    await mock.close();
  }
}

function recordImage(ref, outPath) {
  const existing = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, "utf8")) : {};
  existing.imageBytes = imageSizes(ref);
  fs.writeFileSync(outPath, JSON.stringify(existing, null, 2) + "\n");
  console.log(JSON.stringify(existing.imageBytes));
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  try {
    if (argv[0] === "--image" && argv.length === 3) recordImage(argv[1], argv[2]);
    else if (argv.length === 5) await measure(argv);
    else {
      console.error(USAGE);
      process.exit(2);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
