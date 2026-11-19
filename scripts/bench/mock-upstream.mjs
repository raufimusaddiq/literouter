#!/usr/bin/env node
// Tiny OpenAI-compatible mock upstream for gateway benchmarks (node built-ins only).
//
//   node scripts/bench/mock-upstream.mjs --port 9101 --chunks 200 --chunk-delay-ms 20
//
// Options (flag or env):
//   --port MOCK_PORT (9101)   --host MOCK_HOST (127.0.0.1)
//   --chunks MOCK_CHUNKS                    stream chunk count; default = request max_tokens, else 50
//   --chunk-delay-ms MOCK_CHUNK_DELAY_MS    delay between chunks (20)
//   --first-byte-delay-ms MOCK_FIRST_BYTE_DELAY_MS   delay before the first byte (0)
//   --tokens-per-chunk MOCK_TOKENS_PER_CHUNK         tokens per content delta (1)
//   --nonstream-delay-ms MOCK_NONSTREAM_DELAY_MS     delay before a non-stream reply (0)
// Endpoints: POST /v1/chat/completions, GET /v1/models, GET /_stats (open sockets / in-flight).
import http from "node:http";
import { pathToFileURL } from "node:url";

function argOrEnv(argv, flag, envName, dflt) {
  const i = argv.indexOf(`--${flag}`);
  if (i !== -1 && argv[i + 1] !== undefined) return argv[i + 1];
  if (process.env[envName] !== undefined) return process.env[envName];
  return dflt;
}

function clampInt(v, min, max, dflt) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

export function startMock(opts = {}) {
  const cfg = {
    host: opts.host ?? "127.0.0.1",
    port: Number(opts.port ?? 9101),
    chunks: opts.chunks ?? null,
    chunkDelayMs: clampInt(opts.chunkDelayMs ?? 20, 0, 60000, 20),
    firstByteDelayMs: clampInt(opts.firstByteDelayMs ?? 0, 0, 60000, 0),
    tokensPerChunk: clampInt(opts.tokensPerChunk ?? 1, 1, 64, 1),
    nonstreamDelayMs: clampInt(opts.nonstreamDelayMs ?? 0, 0, 60000, 0),
  };
  const stats = { total: 0, inflight: 0, completed: 0, aborted: 0 };
  const sockets = new Set();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/_stats") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ ...stats, openSockets: sockets.size }));
    }
    if (req.method === "GET" && url.pathname.endsWith("/models")) {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ object: "list", data: [{ id: "bench", object: "model", created: 0, owned_by: "mock" }] }));
    }
    if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
      const bufs = [];
      req.on("data", (c) => bufs.push(c));
      req.on("end", () => handleChat(res, Buffer.concat(bufs).toString("utf8")));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });

  function handleChat(res, raw) {
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      res.statusCode = 400;
      return res.end("bad json");
    }
    stats.total++;
    stats.inflight++;
    let finished = false;
    const done = (aborted) => {
      if (finished) return;
      finished = true;
      stats.inflight--;
      if (aborted) stats.aborted++;
      else stats.completed++;
    };
    const model = body.model || "bench";
    const id = `chatcmpl-mock-${stats.total}`;
    const created = Math.floor(Date.now() / 1000);
    const nChunks = clampInt(cfg.chunks != null ? cfg.chunks : body.max_tokens, 1, 10000, 50);
    const promptTokens = Math.max(1, Math.ceil(raw.length / 4));
    const completionTokens = nChunks * cfg.tokensPerChunk;
    const word = "tok ".repeat(cfg.tokensPerChunk);
    const usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };

    // `close` fires on the response when the peer went away before we ended it.
    res.on("close", () => {
      if (!res.writableEnded) done(true);
    });

    if (!body.stream) {
      const reply = () => {
        if (finished) return;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          id, object: "chat.completion", created, model,
          choices: [{ index: 0, message: { role: "assistant", content: word.repeat(nChunks).trim() }, finish_reason: "stop" }],
          usage,
        }));
        done(false);
      };
      // Delay 0 replies inline: setTimeout(0) is quantised to ~15ms on Windows, which would hide gateway overhead.
      if (cfg.nonstreamDelayMs > 0) setTimeout(reply, cfg.nonstreamDelayMs);
      else reply();
      return;
    }

    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const send = (obj) => res.write(`data: ${typeof obj === "string" ? obj : JSON.stringify(obj)}\n\n`);
    const frame = (delta, finish = null, extra = {}) => ({
      id, object: "chat.completion.chunk", created, model,
      choices: [{ index: 0, delta, finish_reason: finish }], ...extra,
    });
    let sent = 0;
    const tick = () => {
      if (finished || res.destroyed) return;
      if (sent === 0) send(frame({ role: "assistant", content: "" }));
      if (sent < nChunks) {
        send(frame({ content: word }));
        sent++;
        if (cfg.chunkDelayMs > 0) setTimeout(tick, cfg.chunkDelayMs);
        else setImmediate(tick);
        return;
      }
      send(frame({}, "stop"));
      send({ id, object: "chat.completion.chunk", created, model, choices: [], usage });
      send("[DONE]");
      res.end();
      done(false);
    };
    if (cfg.firstByteDelayMs > 0) setTimeout(tick, cfg.firstByteDelayMs);
    else tick();
  }

  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  return new Promise((resolve) => {
    server.listen(cfg.port, cfg.host, () => resolve({
      server, stats, cfg,
      url: `http://${cfg.host}:${server.address().port}`,
      openSockets: () => sockets.size,
      close: () => new Promise((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
    }));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const a = process.argv.slice(2);
  const chunks = argOrEnv(a, "chunks", "MOCK_CHUNKS", null);
  const m = await startMock({
    host: argOrEnv(a, "host", "MOCK_HOST", "127.0.0.1"),
    port: argOrEnv(a, "port", "MOCK_PORT", 9101),
    chunks: chunks === null ? null : Number(chunks),
    chunkDelayMs: argOrEnv(a, "chunk-delay-ms", "MOCK_CHUNK_DELAY_MS", 20),
    firstByteDelayMs: argOrEnv(a, "first-byte-delay-ms", "MOCK_FIRST_BYTE_DELAY_MS", 0),
    tokensPerChunk: argOrEnv(a, "tokens-per-chunk", "MOCK_TOKENS_PER_CHUNK", 1),
    nonstreamDelayMs: argOrEnv(a, "nonstream-delay-ms", "MOCK_NONSTREAM_DELAY_MS", 0),
  });
  console.log(`mock upstream listening on ${m.url} (config ${JSON.stringify(m.cfg)})`);
}
