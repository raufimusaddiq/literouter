#!/usr/bin/env node
// End-to-end MOCK benchmark: spawns mock upstreams + the built gateway (node custom-server.js,
// temp DATA_DIR), provisions a provider node + API key through the dashboard API, then runs
//   a) overhead (direct vs gateway, c=1)   b) concurrency sweep   c) soak + RSS sampling   d) client-abort
// and writes bench-results/<ts>-mock.{md,json}.  Run `npm run build` first.
//
//   node scripts/bench/mock-suite.mjs [--soak-seconds 600] [--only a,b,c,d] [--gw-port 20190]
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMock } from "./mock-upstream.mjs";
import { runBench } from "./run.mjs";
import { fmt, slope } from "./stats.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i !== -1 ? argv[i + 1] : d; };
const GW_PORT = Number(arg("gw-port", 20190));
const FAST_PORT = Number(arg("mock-fast-port", 9101));   // no delay, for overhead measurement
const SLOW_PORT = Number(arg("mock-slow-port", 9102));   // 20ms chunk delay, for streams
const SOAK_SEC = Number(arg("soak-seconds", 600));
const only = new Set(String(arg("only", "a,b,c,d")).split(","));
const PASSWORD = "bench-password";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rssMb(pid) {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
      const kb = Number((out.split('","')[4] || "").replace(/[^0-9]/g, ""));
      return kb / 1024;
    }
    const m = /VmRSS:\s+(\d+) kB/.exec(fs.readFileSync(`/proc/${pid}/status`, "utf8"));
    return m ? Number(m[1]) / 1024 : NaN;
  } catch { return NaN; }
}

/** Every process in the gateway's tree (custom-server may fork nothing, but be safe). */
function treeRssMb(pid) { return rssMb(pid); }

async function waitHttp(url, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch { /* retry */ }
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${url}`);
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lr-bench-"));
  const fast = await startMock({ port: FAST_PORT, chunkDelayMs: 0 });
  const slow = await startMock({ port: SLOW_PORT, chunkDelayMs: 20 });
  const gwLog = fs.openSync(path.join(dataDir, "gateway.log"), "a");
  const gw = spawn(process.execPath, ["custom-server.js"], {
    cwd: repoRoot,
    env: {
      ...process.env, NODE_ENV: "production", PORT: String(GW_PORT), HOSTNAME: "127.0.0.1", DATA_DIR: dataDir,
      INITIAL_PASSWORD: PASSWORD, JWT_SECRET: "bench-jwt-secret-bench-jwt-secret", API_KEY_SECRET: "bench-api-secret",
      MACHINE_ID_SALT: "bench-salt", AUTH_COOKIE_SECURE: "false", NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", gwLog, gwLog],
  });
  const cleanup = async () => { try { gw.kill(); } catch { /* gone */ } await fast.close(); await slow.close(); };
  process.on("SIGINT", () => cleanup().then(() => process.exit(130)));

  try {
    const origin = `http://127.0.0.1:${GW_PORT}`;
    await waitHttp(`${origin}/api/auth/status`);

    // --- provision through the same endpoints the dashboard uses ---
    const login = await fetch(`${origin}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: PASSWORD }),
    });
    if (!login.ok) throw new Error(`login failed: ${login.status}`);
    const cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
    const api = async (p, body) => {
      const r = await fetch(`${origin}${p}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`${p} -> ${r.status} ${JSON.stringify(j)}`);
      return j;
    };
    const models = [];
    for (const [prefix, mock] of [["mockfast", fast], ["mockslow", slow]]) {
      const { node } = await api("/api/provider-nodes", { name: prefix, prefix, apiType: "chat", baseUrl: `${mock.url}/v1`, type: "openai-compatible" });
      await api("/api/providers", { provider: node.id, name: `${prefix}-conn`, apiKey: "mock-upstream-key" });
      models.push(`${prefix}/bench`);
    }
    const { key } = await api("/api/keys", { name: "bench" });
    const [fastModel, slowModel] = models;
    const gwBase = `${origin}/v1`;

    // sanity: one request through the gateway
    const probe = await runBench({ baseUrl: gwBase, key, model: slowModel, mode: "nonstream", requests: 1, maxTokens: 5, label: "probe" });
    if (probe.report.failed) throw new Error(`gateway probe failed: ${JSON.stringify(probe.report.errors)} (see ${dataDir}/gateway.log)`);

    const out = { startedAt: new Date().toISOString(), node: process.version, platform: `${process.platform} ${os.cpus().length}cpu`, sections: {} };
    const md = [`# Mock-mode gateway benchmark`, "", `- ${out.startedAt}; node ${process.version}; ${out.platform}; gateway \`node custom-server.js\` (production build), mock upstream on loopback`, ""];
    const row = (r) => `| ${r.label} | ${r.total} | ${r.failed} | ${fmt(r.throughputReqPerSec, 1)} | ${fmt(r.ttfbMs.p50)} / ${fmt(r.ttfbMs.p99)} | ${fmt(r.ttftMs.p50)} / ${fmt(r.ttftMs.p99)} | ${fmt(r.totalMs.p50)} / ${fmt(r.totalMs.p99)} | ${fmt(r.maxInterChunkGapMs.max)} |`;
    const head = ["| run | reqs | failed | req/s | TTFB p50/p99 ms | TTFT p50/p99 ms | total p50/p99 ms | max chunk gap ms |", "|---|---|---|---|---|---|---|---|"];

    // ---- a) overhead ----
    if (only.has("a")) {
      const res = {};
      for (const mode of ["nonstream", "stream"]) {
        const common = { mode, requests: 200, concurrency: 1, maxTokens: 20, promptSize: 16 };
        const direct = await runBench({ ...common, baseUrl: `${fast.url}/v1`, key: "x", model: "bench", label: `direct-${mode}` });
        const viaGw = await runBench({ ...common, baseUrl: gwBase, key, model: fastModel, label: `gateway-${mode}` });
        res[mode] = { direct: direct.report, gateway: viaGw.report };
      }
      out.sections.a = res;
      md.push("## a) Gateway overhead (concurrency 1, 200 requests, 20 tokens, mock with no artificial delay)", "", ...head);
      for (const m of ["nonstream", "stream"]) md.push(row(res[m].direct), row(res[m].gateway));
      md.push("", "| mode | added total p50 ms | added total p99 ms | added TTFB p50 ms | added TTFB p99 ms | added TTFT p50 ms |", "|---|---|---|---|---|---|");
      for (const m of ["nonstream", "stream"]) {
        const d = res[m].direct, g = res[m].gateway;
        md.push(`| ${m} | ${fmt(g.totalMs.p50 - d.totalMs.p50)} | ${fmt(g.totalMs.p99 - d.totalMs.p99)} | ${fmt(g.ttfbMs.p50 - d.ttfbMs.p50)} | ${fmt(g.ttfbMs.p99 - d.ttfbMs.p99)} | ${fmt(g.ttftMs.p50 - d.ttftMs.p50)} |`);
      }
      const fastStats = await (await fetch(`${fast.url}/_stats`)).json();
      out.sections.a.upstreamStats = fastStats;
      md.push(`Mock upstream saw ${fastStats.total} requests (expected 800: 400 direct + 400 via gateway).`, "");
      console.log("a) done");
    }

    // ---- b) sweep ----
    if (only.has("b")) {
      const res = [];
      for (const c of [1, 10, 50, 100]) {
        const r = await runBench({ baseUrl: gwBase, key, model: slowModel, mode: "stream", concurrency: c, requests: Math.max(c * 2, 10), maxTokens: 200, label: `sweep-c${c}` });
        res.push(r.report);
        console.log(`b) c=${c} done`);
      }
      out.sections.b = res;
      md.push("## b) Concurrency sweep (streams of 200 chunks x 20ms = ~4s each, through gateway)", "", ...head, ...res.map(row), "",
        "Ideal stream wall time is ~4.0s+TTFB; `max chunk gap` > ~100ms means a visible stall.", "");
    }

    // ---- c) soak ----
    if (only.has("c")) {
      const samples = [];
      const t0 = Date.now();
      const dbFile = () => { try { const d = path.join(dataDir, "db"); return fs.readdirSync(d).filter((f) => /^data.sqlite/.test(f)).map((f) => [f, fs.statSync(path.join(d, f)).size]); } catch { return []; } };
      const usageOf = () => { const d = path.join(os.homedir(), ".9router"); try { return fs.readdirSync(d).map((f) => [f, fs.statSync(path.join(d, f)).size]); } catch { return []; } };
      const usageBefore = Object.fromEntries(usageOf());
      const sampler = setInterval(() => {
        samples.push({ t: (Date.now() - t0) / 1000, rssMb: treeRssMb(gw.pid), files: Object.fromEntries(dbFile()) });
      }, 10000);
      samples.push({ t: 0, rssMb: treeRssMb(gw.pid), files: Object.fromEntries(dbFile()) });
      const soak = await runBench({ baseUrl: gwBase, key, model: slowModel, mode: "stream", concurrency: 20, duration: SOAK_SEC, maxTokens: 200, label: "soak-c20" });
      clearInterval(sampler);
      samples.push({ t: (Date.now() - t0) / 1000, rssMb: treeRssMb(gw.pid), files: Object.fromEntries(dbFile()) });
      await sleep(5000);
      const settled = treeRssMb(gw.pid);
      const usageAfter = Object.fromEntries(usageOf());
      const valid = samples.filter((s) => Number.isFinite(s.rssMb));
      const xs = valid.map((s) => s.t / 60), ys = valid.map((s) => s.rssMb);
      const third = Math.max(1, Math.floor(valid.length / 3));
      const avg = (a) => a.reduce((x, y) => x + y.rssMb, 0) / a.length;
      const growth = { startMb: valid[0]?.rssMb, endMb: valid.at(-1)?.rssMb, peakMb: Math.max(...ys), settledAfter5sMb: settled, slopeMbPerMin: slope(xs, ys), firstThirdAvg: avg(valid.slice(0, third)), lastThirdAvg: avg(valid.slice(-third)) };
      out.sections.c = { soak, samples, growth, dbFiles: samples.at(-1).files, usageBefore, usageAfter };
      md.push(`## c) Soak (${SOAK_SEC}s, concurrency 20 streams, RSS sampled every 10s)`, "", ...head, row(soak.report), "",
        `- RSS: start ${fmt(growth.startMb)} MB, end ${fmt(growth.endMb)} MB, peak ${fmt(growth.peakMb)} MB, 5s after load stopped ${fmt(growth.settledAfter5sMb)} MB`,
        `- RSS trend: ${fmt(growth.slopeMbPerMin, 2)} MB/min (least squares); first-third avg ${fmt(growth.firstThirdAvg)} MB vs last-third avg ${fmt(growth.lastThirdAvg)} MB`,
        `- gateway DATA_DIR files at end (bytes): ${JSON.stringify(samples.at(-1).files)}; at start: ${JSON.stringify(samples[0].files)}`,
        `- ~/.9router usage files before -> after (bytes): ${JSON.stringify(usageBefore)} -> ${JSON.stringify(usageAfter)}`,
        "", "<details><summary>RSS samples</summary>", "", "| t (s) | RSS MB |", "|---|---|", ...samples.map((s) => `| ${fmt(s.t, 0)} | ${fmt(s.rssMb)} |`), "", "</details>", "");
      console.log("c) done");
    }

    // ---- d) abort ----
    if (only.has("d")) {
      const before = await (await fetch(`${slow.url}/_stats`)).json();
      const r = await runBench({ baseUrl: gwBase, key, model: slowModel, mode: "stream", concurrency: 50, requests: 50, maxTokens: 200, abortAfterMs: 1000, label: "abort-c50" });
      const t1 = await (await fetch(`${slow.url}/_stats`)).json();
      await sleep(5000);
      const after = await (await fetch(`${slow.url}/_stats`)).json();
      // The gateway's own pending-request view (what the dashboard shows as in-flight).
      let gwPending = null;
      try { gwPending = await (await fetch(`${origin}/api/usage/stream`, { headers: { cookie }, signal: AbortSignal.timeout(2000) })).text().catch(() => null); } catch { gwPending = null; }
      out.sections.d = { client: r.report, upstreamBefore: before, upstreamImmediately: t1, upstreamAfter5s: after, gwPending: gwPending ? gwPending.slice(0, 600) : null };
      md.push("## d) Client abort (50 streams, each aborted after 1s)", "",
        `- client: ${r.report.total} requests, ${r.report.aborted} aborted by client, ${r.report.failed} unexpected errors`,
        `- mock upstream /_stats before: ${JSON.stringify(before)}`,
        `- immediately after clients aborted: ${JSON.stringify(t1)}`,
        `- **5s after: ${JSON.stringify(after)}** (in-flight must be 0; open sockets are keep-alive pool connections, not requests)`,
        `- gateway pending snapshot: ${gwPending ? "`" + gwPending.replace(/\s+/g, " ").slice(0, 300) + "`" : "n/a"}`, "");
      console.log("d) done");
    }

    md.push("## Interpretation", "", "_(see section notes appended by the author below)_", "");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
    fs.mkdirSync(path.join(repoRoot, "bench-results"), { recursive: true });
    const base = path.join(repoRoot, "bench-results", `${ts}-mock`);
    fs.writeFileSync(`${base}.json`, JSON.stringify(out, null, 2));
    fs.writeFileSync(`${base}.md`, md.join("\n"));
    console.log(`wrote ${base}.{md,json}; gateway log ${path.join(dataDir, "gateway.log")}`);
  } finally {
    await cleanup();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
