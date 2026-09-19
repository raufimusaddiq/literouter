import { describe, it, expect, vi, afterEach } from "vitest";
import { __decodeSelfCheck, redisEnabled, redisGet } from "../../src/lib/redis.js";
import net from "node:net";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe("redis client", () => {
  it("decodes pipelined RESP replies in order", () => {
    expect(__decodeSelfCheck()).toBe(true);
  });

  it("is disabled and returns null when REDIS_URL is unset", async () => {
    delete process.env.REDIS_URL;
    expect(redisEnabled()).toBe(false);
    expect(await redisGet("anything")).toBeNull();
  });

  it("fails open when the server is unreachable", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:1";
    process.env.REDIS_TIMEOUT_MS = "50";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(redisEnabled()).toBe(true);
    expect(await redisGet("anything")).toBeNull();
    warn.mockRestore();
  });
});

// A tiny RESP server so the socket lifecycle is exercised without a real Redis.
function startFakeRedis() {
  const store = new Map();
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", (chunk) => {
      // Commands arrive one per write from the client, so a crude parse is enough.
      const parts = chunk.toString().split("\r\n").filter((l) => l.startsWith("$") === false && l !== "" && l[0] !== "*");
      const [cmd, key, value] = parts;
      if (cmd === "GET") {
        const v = store.get(key);
        socket.write(v === undefined ? "$-1\r\n" : `$${Buffer.byteLength(v)}\r\n${v}\r\n`);
      } else if (cmd === "SET") {
        store.set(key, value);
        socket.write("+OK\r\n");
      } else if (cmd === "DEL") {
        store.delete(key);
        socket.write(":1\r\n");
      } else {
        socket.write("+OK\r\n");
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, sockets, port: server.address().port }));
  });
}

describe("redis client — connection reuse", () => {
  let fake;

  afterEach(async () => {
    if (!fake) return;
    // close() waits for open connections to end, and the client holds one, so
    // drop them first.
    for (const socket of fake.sockets) socket.destroy();
    await new Promise((r) => fake.server.close(r));
    fake = undefined;
  });

  // Regression: the socket timeout was armed once at connect time, so an idle
  // but healthy connection was destroyed after REDIS_TIMEOUT_MS and the next
  // command returned null instead of its value.
  it("keeps serving commands after an idle period longer than the timeout", async () => {
    fake = await startFakeRedis();
    process.env.REDIS_URL = `redis://127.0.0.1:${fake.port}`;
    process.env.REDIS_TIMEOUT_MS = "50";
    process.env.REDIS_KEY_PREFIX = "literouter:test:";

    const { redisSet, redisGet } = await import("../../src/lib/redis.js");
    await redisSet("k", "v");
    expect(await redisGet("k")).toBe("v");

    await new Promise((r) => setTimeout(r, 150)); // 3x the per-command timeout
    expect(await redisGet("k")).toBe("v");
  });
});
