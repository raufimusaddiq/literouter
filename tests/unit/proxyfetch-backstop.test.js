import { describe, it, expect, afterAll } from "bun:test";
import http from "node:http";

process.env.UNDICI_BACKSTOP_MS = "300";
const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
const { UNDICI_BACKSTOP_MS } = await import("../../open-sse/config/runtimeConfig.js");

const sockets = new Set();
const server = http.createServer((req, res) => {
  if (req.url === "/stall") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write("data: x\n\n"); }
  if (req.url === "/fast") { res.writeHead(200); res.end("done"); }
  if (req.url === "/broken") { res.writeHead(200); res.write("partial"); setTimeout(() => req.socket.destroy(), 20); }
  if (req.url === "/drip") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    let n = 0;
    const iv = setInterval(() => { res.write("data: x\n\n"); if (++n === 6) { clearInterval(iv); res.end(); } }, 150);
    res.on("close", () => clearInterval(iv));
  }
});
server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const liveBackstopTimers = new Set();
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = (fn, ms, ...rest) => {
  if (ms !== 300) return realSetTimeout(fn, ms, ...rest);
  const h = realSetTimeout(() => { liveBackstopTimers.delete(h); fn(...rest); }, ms);
  liveBackstopTimers.add(h);
  return h;
};
globalThis.clearTimeout = (h) => { liveBackstopTimers.delete(h); return realClearTimeout(h); };
const base = `http://127.0.0.1:${server.address().port}`;

afterAll(async () => {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  for (const s of sockets) s.destroy();
  await new Promise((r) => server.close(r));
});

describe("undici backstop", () => {
  it("is env-configurable", () => {
    expect(UNDICI_BACKSTOP_MS).toBe(300);
  });

  it("a refresh-style call with no signal times out instead of hanging forever", async () => {
    const t0 = Date.now();
    await expect(proxyAwareFetch(`${base}/hang`, { method: "POST", body: "{}" })).rejects.toBeTruthy();
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("a body that stalls with no signal is cut by the idle backstop", async () => {
    const res = await proxyAwareFetch(`${base}/stall`, {});
    await expect(res.text()).rejects.toBeTruthy();
  });

  it("a healthy stream that outlives the backstop in total is not cut", async () => {
    const res = await proxyAwareFetch(`${base}/drip`, {});
    const text = await res.text();
    expect(text.split("data: x").length - 1).toBe(6);
  });
});

describe("backstop timer hygiene", () => {
  const settle = () => new Promise((r) => realSetTimeout(r, 30));

  it("leaves no live timer after a clean end", async () => {
    const res = await proxyAwareFetch(`${base}/fast`, {});
    expect(await res.text()).toBe("done");
    await settle();
    expect(liveBackstopTimers.size).toBe(0);
  });

  it("leaves no live timer after reader.cancel() mid-read", async () => {
    const res = await proxyAwareFetch(`${base}/stall`, {});
    const reader = res.body.getReader();
    await reader.read();
    const pending = reader.read().catch(() => {});
    await settle();
    expect(liveBackstopTimers.size).toBe(1);
    await reader.cancel();
    await pending;
    expect(liveBackstopTimers.size).toBe(0);
  });

  it("leaves no live timer after the caller aborts mid-body", async () => {
    const ac = new AbortController();
    const res = await proxyAwareFetch(`${base}/stall`, { signal: ac.signal });
    const reader = res.body.getReader();
    await reader.read();
    const pending = reader.read();
    await settle();
    ac.abort();
    await expect(pending).rejects.toBeTruthy();
    await settle();
    expect(liveBackstopTimers.size).toBe(0);
  });

  it("leaves no live timer after the body errors mid-stream", async () => {
    const res = await proxyAwareFetch(`${base}/broken`, {});
    await expect(res.text()).rejects.toBeTruthy();
    await settle();
    expect(liveBackstopTimers.size).toBe(0);
  });

  it("leaves no live timer after an abort before headers", async () => {
    const ac = new AbortController();
    const p = proxyAwareFetch(`${base}/hang`, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toBeTruthy();
    await settle();
    expect(liveBackstopTimers.size).toBe(0);
  });
});

describe("backstop error classification", () => {
  it("a headers-phase timeout carries UND_ERR_HEADERS_TIMEOUT on cause like undici did", async () => {
    const err = await proxyAwareFetch(`${base}/hang`, {}).catch((e) => e);
    expect(err.cause.code).toBe("UND_ERR_HEADERS_TIMEOUT");
    expect(err.cause.name).toBe("HeadersTimeoutError");
    const { isStaleSocketError } = await import("../../open-sse/utils/proxyFetch.js");
    expect(isStaleSocketError(err)).toBe(false);
  });

  it("a body-phase stall carries UND_ERR_BODY_TIMEOUT on cause", async () => {
    const res = await proxyAwareFetch(`${base}/stall`, {});
    const err = await res.text().catch((e) => e);
    expect(err.cause.code).toBe("UND_ERR_BODY_TIMEOUT");
  });
});
