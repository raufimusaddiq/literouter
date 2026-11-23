import { describe, expect, test } from "bun:test";
import { constants, gunzipSync } from "node:zlib";
import { maybeCompress } from "../../src/server/compress.js";
import { json } from "../../src/server/http.js";

const gz = () => new Request("http://h.test/", { headers: { "accept-encoding": "gzip, br" } });
const big = JSON.stringify({ data: "x".repeat(5000) });
const jsonHeaders = { "content-type": "application/json" };

describe("maybeCompress", () => {
  test("gzips a large JSON body when accepted", async () => {
    const res = await maybeCompress(gz(), json({ data: "x".repeat(5000) }));
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("vary")).toContain("Accept-Encoding");
    expect(res.headers.get("content-length")).toBeNull();
    const body = Bun.gunzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(new TextDecoder().decode(body)).toBe(big);
  });

  test("gzips a body with a declared Content-Length and weakens its ETag", async () => {
    const src = new Response(big, { headers: { ...jsonHeaders, "content-length": String(big.length), etag: '"abc"' } });
    const res = await maybeCompress(gz(), src);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("etag")).toBe('W/"abc"');
    expect(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await res.arrayBuffer())))).toBe(big);
  });

  test("gzips a streaming compressible body without holding back the first chunk", async () => {
    const encoder = new TextEncoder();
    let secondWritten = false;
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const src = new Response(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode("first-" + "x".repeat(50)));
          await gate;
          secondWritten = true;
          controller.enqueue(encoder.encode("second"));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/plain" } },
    );
    const res = await maybeCompress(gz(), src);
    expect(res).not.toBe(src);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    const reader = res.body.getReader();
    const parts = [];
    let seen = "";
    while (!seen.includes("first-")) {
      const step = await reader.read();
      expect(step.done).toBe(false);
      parts.push(step.value);
      seen = new TextDecoder().decode(
        gunzipSync(Buffer.concat(parts), { finishFlush: constants.Z_SYNC_FLUSH }),
      );
    }
    expect(secondWritten).toBe(false);
    release();
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      parts.push(step.value);
    }
    expect(secondWritten).toBe(true);
    expect(new TextDecoder().decode(Bun.gunzipSync(Buffer.concat(parts)))).toBe("first-" + "x".repeat(50) + "second");
  });

  test("cancelling the gzip body cancels the source stream", async () => {
    let cancelled = false;
    const src = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("a"));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "text/plain" } },
    );
    const res = await maybeCompress(gz(), src);
    const reader = res.body.getReader();
    await reader.read();
    await reader.cancel();
    expect(cancelled).toBe(true);
  });

  test("gzips a small JSON body like Next", async () => {
    const res = await maybeCompress(gz(), json({ ok: true }));
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("vary")).toContain("Accept-Encoding");
    expect(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await res.arrayBuffer())))).toBe('{"ok":true}');
  });

  test("gzips a bare new Response(JSON.stringify) body", async () => {
    const small = new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    const a = await maybeCompress(gz(), small);
    expect(a.headers.get("content-encoding")).toBe("gzip");
    expect(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await a.arrayBuffer())))).toBe('{"ok":true}');
    const large = new Response(big, { headers: jsonHeaders });
    const b = await maybeCompress(gz(), large);
    expect(b.headers.get("content-encoding")).toBe("gzip");
    expect(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await b.arrayBuffer())))).toBe(big);
  });

  test("gzips text/html", async () => {
    const res = await maybeCompress(gz(), new Response("<p>not found</p>", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-encoding")).toBe("gzip");
  });

  test("keeps a small declared body intact", async () => {
    const src = new Response("{}", { headers: { ...jsonHeaders, "content-length": "2" } });
    const res = await maybeCompress(gz(), src);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toBe("{}");
  });

  test("leaves SSE untouched", async () => {
    const src = new Response("data: " + "x".repeat(5000) + "\n\n", { headers: { "content-type": "text/event-stream" } });
    const res = await maybeCompress(gz(), src);
    expect(res).toBe(src);
    expect(res.headers.get("content-encoding")).toBeNull();
    const nd = new Response('{"a":1}\n', { headers: { "content-type": "application/x-ndjson" } });
    expect(await maybeCompress(gz(), nd)).toBe(nd);
  });

  test("leaves small bodies untouched", async () => {
    const head = new Request("http://h.test/", { method: "HEAD", headers: { "accept-encoding": "gzip" } });
    const a = json({ ok: true });
    expect(await maybeCompress(head, a)).toBe(a);
    const noContent = new Response(null, { status: 204, headers: jsonHeaders });
    expect(await maybeCompress(gz(), noContent)).toBe(noContent);
    const declared = new Response("{}", { headers: { ...jsonHeaders, "content-length": "2" } });
    const res = await maybeCompress(gz(), declared);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toBe("{}");
  });

  test("leaves the body alone without Accept-Encoding gzip", async () => {
    const res = await maybeCompress(new Request("http://h.test/"), json({ data: "x".repeat(5000) }));
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  test("leaves an already encoded response untouched", async () => {
    const src = json({ data: "x".repeat(5000) }, { headers: { "content-encoding": "br" } });
    expect(await maybeCompress(gz(), src)).toBe(src);
  });

  test("leaves HEAD and gzip;q=0 requests untouched", async () => {
    const head = new Request("http://h.test/", { method: "HEAD", headers: { "accept-encoding": "gzip" } });
    const a = json({ data: "x".repeat(5000) });
    expect(await maybeCompress(head, a)).toBe(a);
    const refused = new Request("http://h.test/", { headers: { "accept-encoding": "gzip;q=0" } });
    const b = json({ data: "x".repeat(5000) });
    expect(await maybeCompress(refused, b)).toBe(b);
  });

  test("leaves non-compressible types untouched", async () => {
    const src = new Response("x".repeat(5000), { headers: { "content-type": "image/png" } });
    expect(await maybeCompress(gz(), src)).toBe(src);
  });
});
