import fs from "node:fs";
import http2 from "node:http2";
import path from "node:path";
import zlib from "node:zlib";

const encoder = new TextEncoder();

export const TLS_DIR = path.join(import.meta.dir, "tls");

function record(req, bytes) {
  const url = new URL(req.url);
  const headers = {};
  for (const [name, value] of req.headers) headers[name] = value;
  return {
    method: req.method,
    path: url.pathname + url.search,
    pathname: url.pathname,
    headers,
    bytes,
    text: bytes.toString("utf8"),
  };
}

export async function startExecutorMock() {
  const requests = [];
  const routes = new Map();
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(req) {
      const bytes = Buffer.from(await req.arrayBuffer());
      const entry = record(req, bytes);
      requests.push(entry);
      const handler = routes.get(`${entry.method} ${entry.pathname}`);
      if (!handler) return Response.json({ error: { message: `no route for ${entry.method} ${entry.pathname}` } }, { status: 404 });
      return handler(entry, req);
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    on(method, pathname, handler) {
      routes.set(`${method} ${pathname}`, handler);
    },
    seen(pathname) {
      return requests.filter((r) => r.pathname === pathname);
    },
    last(pathname) {
      return this.seen(pathname).at(-1);
    },
    reset() {
      requests.length = 0;
      routes.clear();
    },
    stop() {
      return server.stop(true);
    },
  };
}

export function sseBody(frames, { done = true } = {}) {
  const lines = frames.map((frame) => `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`);
  if (done) lines.push("data: [DONE]\n\n");
  return lines.join("");
}

export function sse(frames, options) {
  return new Response(sseBody(frames, options), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

export function eventSse(events) {
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

export function ndjson(lines, contentType = "application/x-ndjson") {
  return new Response(lines.map((line) => `${typeof line === "string" ? line : JSON.stringify(line)}\n`).join(""), { headers: { "content-type": contentType } });
}

export function openaiChunks(text, model = "mock-model") {
  const base = { id: "chatcmpl-mock", object: "chat.completion.chunk", created: 1763800000, model };
  return [
    { ...base, choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ];
}

export function openaiCompletion(text, model = "mock-model") {
  return {
    id: "chatcmpl-mock",
    object: "chat.completion",
    created: 1763800000,
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  };
}

export function anthropicSse(text) {
  const events = [
    ["message_start", { type: "message_start", message: { id: "msg_mock", type: "message", role: "assistant", model: "mock-model", content: [], usage: { input_tokens: 3, output_tokens: 0 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  return eventSse(events);
}

export function geminiSse(text) {
  return sse([{ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 } }], { done: false });
}

export function responsesSse(text) {
  const events = [
    ["response.created", { type: "response.created", response: { id: "resp_mock", status: "in_progress" } }],
    ["response.output_text.delta", { type: "response.output_text.delta", item_id: "msg_mock", output_index: 0, content_index: 0, delta: text }],
    ["response.completed", { type: "response.completed", response: { id: "resp_mock", status: "completed", usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } } }],
  ];
  return eventSse(events);
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function eventStreamHeader(name, value) {
  const nameBytes = encoder.encode(name);
  const valueBytes = encoder.encode(value);
  const bytes = new Uint8Array(1 + nameBytes.length + 3 + valueBytes.length);
  let offset = 0;
  bytes[offset++] = nameBytes.length;
  bytes.set(nameBytes, offset);
  offset += nameBytes.length;
  bytes[offset++] = 7;
  new DataView(bytes.buffer).setUint16(offset, valueBytes.length, false);
  offset += 2;
  bytes.set(valueBytes, offset);
  return bytes;
}

export function eventStreamFrame(eventType, payload) {
  const headers = eventStreamHeader(":event-type", eventType);
  const payloadBytes = encoder.encode(JSON.stringify(payload));
  const total = 12 + headers.byteLength + payloadBytes.byteLength + 4;
  const frame = new Uint8Array(total);
  const view = new DataView(frame.buffer);
  view.setUint32(0, total, false);
  view.setUint32(4, headers.byteLength, false);
  view.setUint32(8, crc32(frame.subarray(0, 8)), false);
  frame.set(headers, 12);
  frame.set(payloadBytes, 12 + headers.byteLength);
  view.setUint32(total - 4, crc32(frame.subarray(0, total - 4)), false);
  return frame;
}

export function concatBytes(chunks) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function eventStreamResponse(frames) {
  return new Response(concatBytes(frames), { headers: { "content-type": "application/vnd.amazon.eventstream" } });
}

export function varint(value) {
  const bytes = [];
  let v = value >>> 0;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v & 0x7f);
  return Uint8Array.from(bytes);
}

export function protoString(fieldNum, value) {
  const payload = typeof value === "string" ? encoder.encode(value) : value;
  return concatBytes([varint((fieldNum << 3) | 2), varint(payload.length), payload]);
}

export function connectFrame(payload, flags = 0) {
  const frame = new Uint8Array(5 + payload.length);
  frame[0] = flags;
  new DataView(frame.buffer).setUint32(1, payload.length, false);
  frame.set(payload, 5);
  return frame;
}

export function compress(encoding, text) {
  const raw = Buffer.from(text, "utf8");
  if (encoding === "zstd") return Bun.zstdCompressSync(raw);
  if (encoding === "br") return zlib.brotliCompressSync(raw);
  if (encoding === "gzip") return Bun.gzipSync(raw);
  throw new Error(`unsupported encoding ${encoding}`);
}

export function encoded(encoding, body, contentType = "application/x-ndjson") {
  return new Response(compress(encoding, body), { headers: { "content-type": contentType, "content-encoding": encoding } });
}

export async function startH2Mock() {
  const requests = [];
  let handler = null;
  const server = http2.createSecureServer({
    key: fs.readFileSync(path.join(TLS_DIR, "key.pem")),
    cert: fs.readFileSync(path.join(TLS_DIR, "cert.pem")),
  });
  const streams = new Set();
  server.on("stream", (stream, headers) => {
    streams.add(stream);
    stream.on("close", () => streams.delete(stream));
    const chunks = [];
    const entry = { headers: { ...headers }, chunks, stream, closed: false };
    stream.on("close", () => { entry.closed = true; });
    requests.push(entry);
    stream.on("data", (chunk) => chunks.push(chunk));
    handler?.(stream, entry);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    host: `127.0.0.1:${server.address().port}`,
    url: `https://127.0.0.1:${server.address().port}`,
    requests,
    handle(fn) {
      handler = fn;
    },
    reset() {
      requests.length = 0;
      handler = null;
    },
    stop() {
      for (const stream of streams) stream.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
