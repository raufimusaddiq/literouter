import { describe, expect, test } from "bun:test";
import { maybeCompress } from "../../src/server/compress.js";
import { json } from "../../src/server/http.js";

const gz = () => new Request("http://h.test/", { headers: { "accept-encoding": "gzip, br" } });
const big = JSON.stringify({ data: "x".repeat(5000) });
const jsonHeaders = { "content-type": "application/json" };

describe("maybeCompress", () => {
  test("gzips a large JSON body when accepted", async () => {
    const res = await maybeCompress(gz(), json({ data: "x".repeat(5000) }));
    expect(res.headers.get("content-encoding")).toBe("gzip");
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

  test("leaves a streaming compressible body unbuffered", async () => {
    const encoder = new TextEncoder();
    const src = new Response(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode("first-" + "x".repeat(2000)));
          await Bun.sleep(400);
          controller.enqueue(encoder.encode("second"));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/plain" } },
    );
    const t0 = performance.now();
    const res = await maybeCompress(gz(), src);
    expect(res).toBe(src);
    expect(res.headers.get("content-encoding")).toBeNull();
    const reader = res.body.getReader();
    const first = await reader.read();
    const elapsed = performance.now() - t0;
    expect(new TextDecoder().decode(first.value).startsWith("first-")).toBe(true);
    expect(elapsed).toBeLessThan(250);
    await reader.cancel();
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
  });

  test("leaves small bodies untouched", async () => {
    const res = await maybeCompress(gz(), json({}));
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
