import { describe, expect, test } from "bun:test";
import { maybeCompress } from "../../src/server/compress.js";

const gz = () => new Request("http://h.test/", { headers: { "accept-encoding": "gzip, br" } });
const big = JSON.stringify({ data: "x".repeat(5000) });
const jsonHeaders = { "content-type": "application/json" };

describe("maybeCompress", () => {
  test("gzips a large JSON body when accepted", async () => {
    const res = await maybeCompress(gz(), new Response(big, { headers: jsonHeaders }));
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("vary")).toContain("Accept-Encoding");
    expect(res.headers.get("content-length")).toBeNull();
    const body = Bun.gunzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(new TextDecoder().decode(body)).toBe(big);
  });

  test("leaves SSE untouched", async () => {
    const src = new Response("data: " + "x".repeat(5000) + "\n\n", { headers: { "content-type": "text/event-stream" } });
    const res = await maybeCompress(gz(), src);
    expect(res).toBe(src);
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  test("leaves small bodies untouched", async () => {
    const res = await maybeCompress(gz(), new Response("{}", { headers: jsonHeaders }));
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toBe("{}");
  });

  test("leaves the body alone without Accept-Encoding gzip", async () => {
    const res = await maybeCompress(new Request("http://h.test/"), new Response(big, { headers: jsonHeaders }));
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  test("leaves an already encoded response untouched", async () => {
    const src = new Response(big, { headers: { ...jsonHeaders, "content-encoding": "br" } });
    expect(await maybeCompress(gz(), src)).toBe(src);
  });

  test("leaves non-compressible types untouched", async () => {
    const src = new Response("x".repeat(5000), { headers: { "content-type": "image/png" } });
    expect(await maybeCompress(gz(), src)).toBe(src);
  });
});
