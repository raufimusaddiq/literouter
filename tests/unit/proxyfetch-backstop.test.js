import { describe, it, expect, afterAll } from "bun:test";
import http from "node:http";

process.env.UNDICI_BACKSTOP_MS = "300";
const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
const { UNDICI_BACKSTOP_MS } = await import("../../open-sse/config/runtimeConfig.js");

const sockets = new Set();
const server = http.createServer((req, res) => {
  if (req.url === "/stall") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write("data: x\n\n"); }
  if (req.url === "/drip") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    let n = 0;
    const iv = setInterval(() => { res.write("data: x\n\n"); if (++n === 6) { clearInterval(iv); res.end(); } }, 150);
    res.on("close", () => clearInterval(iv));
  }
});
server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

afterAll(async () => {
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
