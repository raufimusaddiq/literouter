#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { summarize, fmt } from "./stats.mjs";

const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];

export function makePrompt(approxTokens) {
  const n = Math.max(1, Math.floor(approxTokens));
  const out = [];
  for (let i = 0; i < n; i++) out.push(WORDS[i % WORDS.length]);
  return `Reply briefly. Context: ${out.join(" ")}`;
}

function classifyError(err, timedOut) {
  if (timedOut) return "timeout";
  const code = err?.cause?.code || err?.code;
  if (code) return String(code);
  return err?.name || "error";
}

async function oneRequest(opts, seq) {
  const stream = opts.mode === "stream";
  const body = {
    model: opts.model,
    messages: [{ role: "user", content: makePrompt(opts.promptSize) }],
    max_tokens: opts.maxTokens,
    stream,
  };
  if (stream) body.stream_options = { include_usage: true };
  const ac = new AbortController();
  let timedOut = false;
  let aborted = false;
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, opts.timeoutMs);
  const abortTimer = opts.abortAfterMs > 0 ? setTimeout(() => { aborted = true; ac.abort(); }, opts.abortAfterMs) : null;
  const r = { seq, status: 0, ttfbMs: NaN, ttftMs: NaN, totalMs: NaN, chunks: 0, outputTokens: 0, tokensPerSec: NaN, error: null, aborted: false, maxGapMs: 0 };
  const t0 = performance.now();
  try {
    const res = await fetch(`${opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.key}` },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    r.ttfbMs = performance.now() - t0;
    r.status = res.status;
    if (!res.ok) {
      await res.text().catch(() => {});
      r.error = `http_${res.status}`;
    } else if (!stream) {
      const json = await res.json();
      r.outputTokens = json?.usage?.completion_tokens ?? 0;
      r.ttftMs = performance.now() - t0;
    } else {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let sawDone = false;
      let usageTokens = 0;
      let lastChunkAt = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const ev = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of ev.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") { sawDone = true; continue; }
            let obj;
            try { obj = JSON.parse(data); } catch { continue; }
            if (obj?.error) { r.error = "stream_error"; continue; }
            if (obj?.usage?.completion_tokens) usageTokens = obj.usage.completion_tokens;
            const content = obj?.choices?.[0]?.delta?.content;
            if (typeof content === "string" && content.length > 0) {
              const now = performance.now();
              if (r.chunks === 0) r.ttftMs = now - t0;
              else r.maxGapMs = Math.max(r.maxGapMs, now - lastChunkAt);
              lastChunkAt = now;
              r.chunks++;
            }
          }
        }
      }
      r.outputTokens = usageTokens || r.chunks;
      if (!sawDone && !r.error) r.error = "no_done";
    }
  } catch (err) {
    if (aborted && !timedOut) r.aborted = true;
    else r.error = classifyError(err, timedOut);
  } finally {
    clearTimeout(timer);
    if (abortTimer) clearTimeout(abortTimer);
  }
  r.totalMs = performance.now() - t0;
  if (!r.error && !r.aborted && r.outputTokens > 0) {
    const genMs = stream && Number.isFinite(r.ttftMs) ? r.totalMs - r.ttftMs : r.totalMs;
    r.tokensPerSec = genMs > 0 ? (r.outputTokens / genMs) * 1000 : NaN;
  }
  return r;
}

export async function runBench(input) {
  const opts = {
    baseUrl: String(input.baseUrl || "http://127.0.0.1:20128/v1").replace(/\/+$/, ""),
    key: input.key || process.env.LITEROUTER_BENCH_KEY || "",
    model: input.model || "bench",
    mode: input.mode === "nonstream" ? "nonstream" : "stream",
    concurrency: Math.max(1, Number(input.concurrency) || 1),
    requests: input.requests ? Number(input.requests) : 0,
    duration: input.duration ? Number(input.duration) : 0,
    promptSize: Number(input.promptSize) || 16,
    maxTokens: Number(input.maxTokens) || 128,
    abortAfterMs: Number(input.abortAfterMs) || 0,
    timeoutMs: Number(input.timeoutMs) || 120000,
    label: input.label || "bench",
  };
  if (!opts.requests && !opts.duration) opts.requests = 20;

  const results = [];
  let started = 0;
  const startedAt = Date.now();
  const t0 = performance.now();
  const deadline = opts.duration ? t0 + opts.duration * 1000 : Infinity;
  const worker = async () => {
    for (;;) {
      if (opts.requests && started >= opts.requests) return;
      if (performance.now() >= deadline) return;
      const seq = started++;
      results.push(await oneRequest(opts, seq));
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency }, worker));
  const wallSec = (performance.now() - t0) / 1000;

  const ok = results.filter((x) => !x.error && !x.aborted);
  const errors = {};
  for (const x of results) if (x.error) errors[x.error] = (errors[x.error] || 0) + 1;
  const totalTokens = ok.reduce((a, x) => a + x.outputTokens, 0);
  const report = {
    label: opts.label,
    startedAt: new Date(startedAt).toISOString(),
    config: {
      baseUrl: opts.baseUrl, model: opts.model, mode: opts.mode, concurrency: opts.concurrency,
      requests: opts.requests || null, duration: opts.duration || null, promptSize: opts.promptSize,
      maxTokens: opts.maxTokens, abortAfterMs: opts.abortAfterMs || null,
    },
    wallSec,
    total: results.length,
    succeeded: ok.length,
    aborted: results.filter((x) => x.aborted).length,
    failed: results.filter((x) => x.error).length,
    errorRate: results.length ? results.filter((x) => x.error).length / results.length : 0,
    errors,
    throughputReqPerSec: wallSec > 0 ? ok.length / wallSec : 0,
    throughputTokPerSec: wallSec > 0 ? totalTokens / wallSec : 0,
    ttfbMs: summarize(ok.map((x) => x.ttfbMs)),
    ttftMs: summarize(ok.map((x) => x.ttftMs)),
    totalMs: summarize(ok.map((x) => x.totalMs)),
    tokensPerSec: summarize(ok.map((x) => x.tokensPerSec)),
    chunks: summarize(ok.map((x) => x.chunks)),
    maxInterChunkGapMs: summarize(ok.map((x) => x.maxGapMs)),
    statusCodes: results.reduce((m, x) => ({ ...m, [x.status]: (m[x.status] || 0) + 1 }), {}),
  };
  return { report, results };
}

const row = (name, s) =>
  `| ${name} | ${fmt(s.p50)} | ${fmt(s.p90)} | ${fmt(s.p99)} | ${fmt(s.max)} | ${fmt(s.mean)} |`;

export function toMarkdown(rep) {
  const c = rep.config;
  const lines = [
    `# Bench: ${rep.label}`,
    "",
    `- started: ${rep.startedAt}`,
    `- target: \`${c.baseUrl}\` model \`${c.model}\` mode \`${c.mode}\``,
    `- concurrency ${c.concurrency}, ${c.requests ? `${c.requests} requests` : `${c.duration}s duration`}, prompt ~${c.promptSize} tok, max_tokens ${c.maxTokens}${c.abortAfterMs ? `, abort after ${c.abortAfterMs}ms` : ""}`,
    `- requests: ${rep.total} (ok ${rep.succeeded}, failed ${rep.failed}, aborted ${rep.aborted}); error rate ${fmt(rep.errorRate * 100, 2)}%`,
    `- wall ${fmt(rep.wallSec, 1)}s; throughput ${fmt(rep.throughputReqPerSec, 2)} req/s, ${fmt(rep.throughputTokPerSec, 0)} tok/s`,
    `- status codes: ${JSON.stringify(rep.statusCodes)}; errors: ${JSON.stringify(rep.errors)}`,
    "",
    "| metric (ms unless noted) | p50 | p90 | p99 | max | mean |",
    "|---|---|---|---|---|---|",
    row("TTFB", rep.ttfbMs),
    row("TTFT (first content delta)", rep.ttftMs),
    row("total", rep.totalMs),
    row("output tok/s per request", rep.tokensPerSec),
    row("chunks per request", rep.chunks),
    row("max inter-chunk gap", rep.maxInterChunkGapMs),
    "",
  ];
  return lines.join("\n");
}

export function writeReport(rep, outDir = "bench-results") {
  fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
  const base = path.join(outDir, `${ts}-${rep.label}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(rep, null, 2));
  fs.writeFileSync(`${base}.md`, toMarkdown(rep));
  return base;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[k] = true;
    else { out[k] = next; i++; }
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = parseArgs(process.argv.slice(2));
  const key = args.key || process.env.LITEROUTER_BENCH_KEY || "";
  if (!key) {
    console.error("missing API key: set LITEROUTER_BENCH_KEY (or --key)");
    process.exit(2);
  }
  const { report } = await runBench({ ...args, key });
  const md = toMarkdown(report);
  console.log(md);
  if (!args.noWrite) console.log(`wrote ${writeReport(report, args.outDir || "bench-results")}.{json,md}`);
  process.exit(report.failed > 0 ? 1 : 0);
}
