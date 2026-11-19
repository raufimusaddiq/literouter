import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { createRequire } from "node:module";
import { SSE_HEADERS, SSE_HEADERS_CORS, SSE_HEADERS_NO_BUFFER, sseResponseHeaders } from "open-sse/utils/sseConstants.js";

// Same middleware Next (>=16.4.6) applies to route-handler responses.
const require = createRequire(import.meta.url);
const compression = require("../../node_modules/next/dist/compiled/compression");

const servers = [];
afterEach(() => { while (servers.length) servers.pop().close(); });

// Serve a streaming Response (a "route handler" result) through the compression middleware,
// writing chunks with delays so incremental delivery is observable.
async function serve(makeResponse) {
  const compress = compression();
  const server = http.createServer(async (req, res) => {
    compress(req, res, () => {});
    const response = makeResponse();
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
      res.flush?.();
    }
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return server.address().port;
}

function slowSse(headers, n = 4) {
  const enc = new TextEncoder();
  let i = 0;
  const body = new ReadableStream({
    async pull(c) {
      if (i >= n) return c.close();
      await new Promise((r) => setTimeout(r, 40));
      c.enqueue(enc.encode(`data: {"token":"${"lorem ipsum ".repeat(20)}${i++}"}\n\n`));
    },
  });
  return new Response(body, { headers });
}

async function fetchChunks(port) {
  const res = await new Promise((resolve, reject) => {
    http.get({ port, host: "127.0.0.1", headers: { "Accept-Encoding": "gzip, br, deflate" } }, resolve).on("error", reject);
  });
  const chunks = [];
  const times = [];
  for await (const c of res) { chunks.push(c); times.push(Date.now()); }
  return { res, chunks, times, text: Buffer.concat(chunks).toString("utf8") };
}

describe("SSE responses survive Next's response compression", () => {
  it.each([["SSE_HEADERS", SSE_HEADERS], ["SSE_HEADERS_CORS", SSE_HEADERS_CORS], ["SSE_HEADERS_NO_BUFFER", SSE_HEADERS_NO_BUFFER]])(
    "%s: not compressed, chunks arrive incrementally",
    async (_n, headers) => {
      const port = await serve(() => slowSse(headers));
      const { res, chunks, times, text } = await fetchChunks(port);
      expect(res.headers["content-encoding"] ?? "").not.toMatch(/gzip|br|deflate/);
      expect(text.match(/^data: /gm)).toHaveLength(4); // plain, parseable SSE
      expect(chunks.length).toBeGreaterThan(1);
      expect(times.at(-1) - times[0]).toBeGreaterThan(60); // spread over time, not one buffered write
    }
  );

  it("control: without the guard headers the middleware compresses the stream", async () => {
    const port = await serve(() => slowSse({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }));
    const { res } = await fetchChunks(port);
    expect(res.headers["content-encoding"]).toBe("gzip");
  });

  it("sseResponseHeaders drops stale upstream encoding and forces the guards", () => {
    const h = sseResponseHeaders({ "content-encoding": "gzip", "content-length": "99", "content-type": "application/x-ndjson", "x-keep": "1" });
    expect(h.get("content-encoding")).toBeNull();
    expect(h.get("content-length")).toBeNull();
    expect(h.get("content-type")).toBe("text/event-stream");
    expect(h.get("cache-control")).toBe("no-cache, no-transform");
    expect(h.get("x-accel-buffering")).toBe("no");
    expect(h.get("x-keep")).toBe("1");
  });

  it("console-logs stream route handler sets the guard headers", async () => {
    const { GET } = await import("@/app/api/console-logs/stream/route.js");
    const ac = new AbortController();
    const res = await GET({ signal: ac.signal });
    expect(res.headers.get("cache-control")).toContain("no-transform");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    ac.abort();
    await res.body.cancel();
  });
});
