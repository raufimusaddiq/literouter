import fs from "node:fs";
import path from "node:path";

const encoder = new TextEncoder();

const chunk = (delta, finish = null) => ({
  id: "chatcmpl-parity",
  object: "chat.completion.chunk",
  created: 1763800000,
  model: "mock-model",
  choices: [{ index: 0, delta, finish_reason: finish }],
});

const completion = {
  id: "chatcmpl-parity",
  object: "chat.completion",
  created: 1763800000,
  model: "mock-model",
  choices: [{ index: 0, message: { role: "assistant", content: "parity ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
};

const sse = (value) => encoder.encode(`data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`);

function streamResponse(frames, { pauseMs = 0, done = true } = {}) {
  const body = new ReadableStream({
    async start(controller) {
      for (let i = 0; i < frames.length; i++) {
        controller.enqueue(sse(frames[i]));
        if (i === 0 && pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
      }
      if (done) controller.enqueue(sse("[DONE]"));
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

function endlessStream(stats) {
  let timer;
  const body = new ReadableStream({
    start(controller) {
      let n = 0;
      timer = setInterval(() => controller.enqueue(sse(chunk({ role: "assistant", content: `t${n++}` }))), 100);
    },
    cancel() {
      clearInterval(timer);
      stats.cancelled++;
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

async function slowJson() {
  await new Promise((r) => setTimeout(r, Number(process.env.MOCK_JSON_DELAY_MS) || 12000));
  return Response.json(completion);
}

function scenario(model, stats) {
  const frames = [chunk({ role: "assistant", content: "par" }), chunk({ content: "ity" }), chunk({}, "stop")];
  switch (model) {
    case "mock-stream":
      return streamResponse(frames);
    case "mock-truncated-stream":
      return streamResponse(frames.slice(0, 1), { done: false });
    case "mock-slow-stream":
      return streamResponse(frames, { pauseMs: Number(process.env.MOCK_STREAM_PAUSE_MS) || 16000 });
    case "mock-slow-json":
      return slowJson();
    case "mock-endless-stream":
      return endlessStream(stats);
    case "mock-429":
      return Response.json({ error: { message: "rate limited", type: "rate_limit_error" } }, { status: 429, headers: { "retry-after": "7" } });
    case "mock-500":
      return Response.json({ error: { message: "upstream exploded", type: "server_error" } }, { status: 500 });
    case "mock-bad-json":
      return new Response("{not json", { status: 200, headers: { "content-type": "application/json" } });
    default:
      return Response.json(completion);
  }
}

export async function startMockUpstream({ port = 0, outDir, hostname = "127.0.0.1" } = {}) {
  const requests = [];
  const stats = { cancelled: 0 };
  let seq = 0;
  const jsonl = outDir ? path.join(outDir, "upstream-requests.jsonl") : null;
  if (jsonl) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(jsonl, "");
  }

  const server = Bun.serve({
    port,
    hostname,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const bytes = Buffer.from(await req.arrayBuffer());
      const body = bytes.toString("utf8");
      const headers = {};
      const wire = [];
      for (const [k, v] of req.headers) {
        headers[k] = v;
        wire.push([k, v]);
      }
      requests.push({ method: req.method, path: url.pathname + url.search, headers, body });
      if (jsonl) {
        fs.appendFileSync(jsonl, JSON.stringify({ seq: seq++, method: req.method, path: url.pathname + url.search, headers: wire, bodyBase64: bytes.toString("base64") }) + "\n");
      }

      if (req.method === "GET" && url.pathname === "/v1/models") {
        return Response.json({ object: "list", data: [{ id: "mock-ok", object: "model" }, { id: "mock-stream", object: "model" }] });
      }
      if (req.method === "POST" && (url.pathname === "/v1/chat/completions" || url.pathname === "/v1/messages")) {
        let model;
        try {
          model = JSON.parse(body).model;
        } catch {
          model = undefined;
        }
        return scenario(model, stats);
      }
      return Response.json({ error: { message: "not found" } }, { status: 404 });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    stats,
    reset() {
      requests.length = 0;
    },
    stop() {
      return server.stop(true);
    },
  };
}
