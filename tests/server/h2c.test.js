import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import net from "node:net";
import { loadServerModule } from "./helpers/inproc.js";

const originalLimit = process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE;
process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE = "1kb";

const { startServer } = await loadServerModule("lr-h2c-");

const BASE_HEADERS = [
  "Connection: Upgrade, HTTP2-Settings",
  "Upgrade: h2c",
  "HTTP2-Settings: AAEAAEAAAAIAAAAAAAMAAAAAAAQBAAAAAAUAAEAAAAYABgAA",
];

let server;
const seen = [];

beforeAll(async () => {
  server = await startServer({
    port: 0,
    hostname: "127.0.0.1",
    routes: {
      "/__h2c": async (req) => {
        const body = await req.text();
        seen.push({ url: new URL(req.url).pathname, body });
        return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
      },
    },
  });
});

afterAll(() => {
  server.stop(true);
  if (originalLimit === undefined) delete process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE;
  else process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE = originalLimit;
});

function upgradeRequest(extraHeaders, writes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = net.createConnection({ host: "127.0.0.1", port: server.port }, async () => {
      socket.write(
        ["POST /__h2c HTTP/1.1", `Host: 127.0.0.1:${server.port}`, ...BASE_HEADERS, ...extraHeaders, "", ""].join("\r\n"),
      );
      for (const part of writes) {
        await Bun.sleep(30);
        socket.write(part);
      }
    });
    socket.setTimeout(5_000, () => {
      socket.destroy();
      reject(new Error("h2c fallback response timed out"));
    });
    const finish = () => {
      socket.destroy();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("latin1");
      const end = text.indexOf("\r\n\r\n");
      if (end < 0) return;
      const length = /\r\ncontent-length: (\d+)/i.exec(text.slice(0, end));
      if (length && text.length - end - 4 >= Number(length[1])) finish();
    });
    socket.on("close", finish);
    socket.on("error", reject);
  });
}

function lastSeen() {
  return seen[seen.length - 1];
}

describe("h2c upgrade requests", () => {
  it("serves h2c POST requests as HTTP/1.1", async () => {
    const body = '{"model":"test","stream":true}';
    const response = await upgradeRequest([`Content-Length: ${Buffer.byteLength(body)}`, "Content-Type: application/json"], [body]);

    expect(lastSeen()).toEqual({ url: "/__h2c", body });
    expect(response).toMatch(/^HTTP\/1\.1 200 OK\r\n/);
    expect(response).toMatch(/\r\nContent-Type: text\/event-stream\r\n/i);
    expect(response).toMatch(/\r\n\r\ndata: \[DONE\]\n\n$/);
  });

  it("rejects an h2c body above the proxy body cap with 413", async () => {
    const before = seen.length;
    const body = "x".repeat(2048);
    const response = await upgradeRequest([`Content-Length: ${body.length}`, "Content-Type: application/json"], [body]);

    expect(response).toMatch(/^HTTP\/1\.1 413 /);
    expect(seen.length).toBe(before);
  });

  it("a chunked h2c request is served with its body intact", async () => {
    const response = await upgradeRequest(["Transfer-Encoding: chunked", "Content-Type: application/json"], ["2\r\n{}\r\n0\r\n\r\n"]);

    expect(lastSeen()).toEqual({ url: "/__h2c", body: "{}" });
    expect(response).toMatch(/^HTTP\/1\.1 200 OK\r\n/);
  });

  it("serves a body that arrives in two writes exactly once", async () => {
    const response = await upgradeRequest(["Content-Length: 10", "Content-Type: application/json"], ["01234", "56789"]);

    expect(response).toMatch(/^HTTP\/1\.1 200 OK\r\n/);
    expect(lastSeen()).toEqual({ url: "/__h2c", body: "0123456789" });
  });

  it("does not answer 413 when a split body stays under the cap", async () => {
    const first = "a".repeat(600);
    const second = "b".repeat(400);
    const response = await upgradeRequest(["Content-Length: 1000", "Content-Type: application/json"], [first, second]);

    expect(response).not.toMatch(/^HTTP\/1\.1 413 /);
    expect(response).toMatch(/^HTTP\/1\.1 200 OK\r\n/);
    expect(lastSeen().body).toBe(first + second);
  });
});
