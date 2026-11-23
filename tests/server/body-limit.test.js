import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import net from "node:net";
import { loadServerModule } from "./helpers/inproc.js";

const originalLimit = process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE;
process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE = "1kb";

const { startServer } = await loadServerModule("lr-body-limit-");
const { parseBodyLimit } = await import("../../src/server/bodyLimit.js");

const DEFAULT_LIMIT = 134217728;
let server;
let base;
const seen = [];

beforeAll(async () => {
  server = await startServer({
    port: 0,
    hostname: "127.0.0.1",
    routes: {
      "/__sink": async (req) => {
        const text = await req.text();
        seen.push(text.length);
        return new Response(String(text.length));
      },
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  if (originalLimit === undefined) delete process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE;
  else process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE = originalLimit;
});

function rawChunked(payloadBytes) {
  return new Promise((resolve, reject) => {
    let data = "";
    const socket = net.connect(server.port, "127.0.0.1");
    socket.setTimeout(10_000, () => socket.destroy(new Error("chunked request timed out")));
    socket.on("data", (chunk) => {
      data += chunk.toString("latin1");
    });
    socket.on("error", (err) => (data.startsWith("HTTP/1.1") ? resolve(data) : reject(err)));
    socket.on("close", () => resolve(data));
    const body = "x".repeat(payloadBytes);
    socket.write(
      `POST /__sink HTTP/1.1\r\nHost: 127.0.0.1\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n${payloadBytes.toString(16)}\r\n${body}\r\n0\r\n\r\n`,
    );
  });
}

describe("parseBodyLimit", () => {
  it.each([
    ["128mb", DEFAULT_LIMIT],
    ["1kb", 1024],
    ["1.5gb", 1610612736],
    ["512", 512],
    ["2 MB", 2097152],
    ["10b", 10],
    ["abc", DEFAULT_LIMIT],
    ["12tb", DEFAULT_LIMIT],
    ["", DEFAULT_LIMIT],
    [undefined, DEFAULT_LIMIT],
  ])("%p -> %p", (raw, expected) => {
    expect(parseBodyLimit(raw)).toBe(expected);
  });
});

describe("request body cap", () => {
  it("a 900-byte POST reaches the handler", async () => {
    const res = await fetch(`${base}/__sink`, { method: "POST", body: "x".repeat(900) });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("900");
    expect(seen).toContain(900);
  });

  it("a 2 KB POST with Content-Length gets 413", async () => {
    const before = seen.length;
    const res = await fetch(`${base}/__sink`, { method: "POST", body: "x".repeat(2048) });
    expect(res.status).toBe(413);
    expect(seen.length).toBe(before);
  });

  it("a 2 KB chunked POST gets 413", async () => {
    const before = seen.length;
    const response = await rawChunked(2048);
    expect(response).toMatch(/^HTTP\/1\.1 413 /);
    expect(seen.length).toBe(before);
  });
});
