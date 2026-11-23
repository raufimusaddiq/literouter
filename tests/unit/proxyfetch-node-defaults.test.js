import { describe, it, expect, afterAll } from "bun:test";
import http from "node:http";
import zlib from "node:zlib";

const { proxyAwareFetch, NODE_FETCH_DEFAULT_HEADERS } = await import("../../open-sse/utils/proxyFetch.js");

const seen = [];
const server = http.createServer((req, res) => {
  seen.push({ url: req.url, headers: req.headers, raw: req.rawHeaders });
  req.resume();
  if (req.url === "/gzip") {
    res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
    res.end(zlib.gzipSync("hello gzip"));
    return;
  }
  if (req.url === "/deflate") {
    res.writeHead(200, { "content-type": "text/plain", "content-encoding": "deflate" });
    res.end(zlib.deflateSync("hello deflate"));
    return;
  }
  res.writeHead(200);
  res.end("ok");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => new Promise((r) => server.close(r)));

const last = () => seen[seen.length - 1].headers;

describe("outbound fetch matches the Node runtime defaults", () => {
  it("pins the default header set", () => {
    expect(NODE_FETCH_DEFAULT_HEADERS).toEqual({
      "accept-encoding": "gzip, deflate",
      "accept-language": "*",
      "sec-fetch-mode": "cors",
      "user-agent": "node",
    });
  });

  it("fills every default when the caller set none", async () => {
    await (await proxyAwareFetch(`${base}/a`, { method: "POST", body: "{}" })).text();
    const h = last();
    expect(h["accept-encoding"]).toBe("gzip, deflate");
    expect(h["user-agent"]).toBe("node");
    expect(h["accept-language"]).toBe("*");
    expect(h["sec-fetch-mode"]).toBe("cors");
    expect(h["cache-control"]).toBeUndefined();
    expect(h.pragma).toBeUndefined();
  });

  it("adds cache-control and pragma for cache: no-store and reload, as undici does", async () => {
    for (const cache of ["no-store", "reload"]) {
      await (await proxyAwareFetch(`${base}/b`, { cache })).text();
      expect(last()["cache-control"]).toBe("no-cache");
      expect(last().pragma).toBe("no-cache");
    }
  });

  it("adds cache-control max-age=0 for cache: no-cache", async () => {
    await (await proxyAwareFetch(`${base}/b2`, { cache: "no-cache" })).text();
    expect(last()["cache-control"]).toBe("max-age=0");
    expect(last().pragma).toBeUndefined();
  });

  it("never overrides a header the caller set, in any case or container", async () => {
    await (await proxyAwareFetch(`${base}/c`, { headers: { "User-Agent": "claude-cli/1.0", "ACCEPT-ENCODING": "identity", "accept-language": "en" } })).text();
    let h = last();
    expect(h["user-agent"]).toBe("claude-cli/1.0");
    expect(h["accept-encoding"]).toBe("identity");
    expect(h["accept-language"]).toBe("en");
    expect(h["sec-fetch-mode"]).toBe("cors");

    await (await proxyAwareFetch(`${base}/d`, { headers: new Headers({ "user-agent": "h-ua", "cache-control": "max-age=0" }), cache: "no-store" })).text();
    h = last();
    expect(h["user-agent"]).toBe("h-ua");
    expect(h["cache-control"]).toBe("max-age=0");
    expect(h.pragma).toBe("no-cache");

    await (await proxyAwareFetch(`${base}/e`, { headers: [["User-Agent", "arr-ua"]] })).text();
    expect(last()["user-agent"]).toBe("arr-ua");
  });

  it("applies on the explicit proxy and relay paths too", async () => {
    await (await proxyAwareFetch(`${base}/f`, { proxy: undefined, method: "GET" }, { vercelRelayUrl: `${base}/relay` })).text();
    const h = last();
    expect(h["user-agent"]).toBe("node");
    expect(h["x-relay-target"]).toBeDefined();
  });

  it("still decompresses gzip and deflate bodies", async () => {
    expect(await (await proxyAwareFetch(`${base}/gzip`)).text()).toBe("hello gzip");
    expect(await (await proxyAwareFetch(`${base}/deflate`)).text()).toBe("hello deflate");
  });

  it("does not mutate the caller's options or headers", async () => {
    const headers = { "x-a": "1" };
    const options = { headers };
    await (await proxyAwareFetch(`${base}/g`, options)).text();
    expect(options.headers).toBe(headers);
    expect(headers).toEqual({ "x-a": "1" });
  });
});
