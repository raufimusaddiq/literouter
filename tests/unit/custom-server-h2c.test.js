import http from "node:http";
import net from "node:net";
import { createRequire } from "node:module";
import { expect, test } from "bun:test";

const require = createRequire(import.meta.url);

process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE = "1kb";

const BASE_HEADERS = [
  "Connection: Upgrade, HTTP2-Settings",
  "Upgrade: h2c",
  "HTTP2-Settings: AAEAAEAAAAIAAAAAAAMAAAAAAAQBAAAAAAUAAEAAAAYABgAA",
];

function upgradeRequest(port, extraHeaders, body) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.write([
        "POST /v1/chat/completions HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        ...BASE_HEADERS,
        ...extraHeaders,
        "",
        "",
      ].join("\r\n"));
      if (body) setImmediate(() => socket.write(body));
    });
    socket.setTimeout(2_000, () => {
      socket.destroy();
      reject(new Error("h2c fallback response timed out"));
    });
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
  });
}

async function withServer(fn) {
  const originalCreateServer = http.createServer;
  delete require.cache[require.resolve("../../custom-server.js")];
  require("../../custom-server.js");
  const seen = {};
  const server = http.createServer(async (req, res) => {
    seen.headers = req.headers;
    seen.url = req.url;
    const body = [];
    for await (const chunk of req) body.push(chunk);
    seen.body = Buffer.concat(body).toString("utf8");
    res.setHeader("Content-Type", "text/event-stream");
    res.end("data: [DONE]\n\n");
  });
  server.on("upgrade", (_req, socket) => socket.destroy());
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    return await fn(server.address().port, seen);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    http.createServer = originalCreateServer;
  }
}

test("serves h2c POST requests as HTTP/1.1", async () => {
  await withServer(async (port, seen) => {
    const body = '{"model":"test","stream":true}';
    const response = await upgradeRequest(port, [
      `Content-Length: ${Buffer.byteLength(body)}`,
      "Content-Type: application/json",
    ], body);

    expect(seen.url).toBe("/v1/chat/completions");
    expect(seen.headers.upgrade).toBeUndefined();
    expect(seen.headers["http2-settings"]).toBeUndefined();
    expect(seen.headers.connection).toBe("close");
    expect(seen.body).toBe(body);

    expect(response).toMatch(/^HTTP\/1\.1 200 OK\r\n/);
    expect(response).toMatch(/\r\nContent-Type: text\/event-stream\r\n/i);
    expect(response).toMatch(/\r\nConnection: close\r\n/i);
    expect(response).toMatch(/\r\n\r\ndata: \[DONE\]\n\n$/);
  });
});

test("rejects an h2c body above the proxy body cap with 413", async () => {
  await withServer(async (port, seen) => {
    const body = "x".repeat(2048);
    const response = await upgradeRequest(port, [
      `Content-Length: ${body.length}`,
      "Content-Type: application/json",
    ], body);

    expect(response).toMatch(/^HTTP\/1\.1 413 Payload Too Large\r\n/);
    expect(seen.url).toBeUndefined();
  });
});

test("rejects a chunked h2c request with 411 instead of dropping the body", async () => {
  await withServer(async (port, seen) => {
    const response = await upgradeRequest(port, [
      "Transfer-Encoding: chunked",
      "Content-Type: application/json",
    ], "10\r\n{}\r\n0\r\n\r\n");

    expect(response).toMatch(/^HTTP\/1\.1 411 Length Required\r\n/);
    expect(seen.url).toBeUndefined();
  });
});
