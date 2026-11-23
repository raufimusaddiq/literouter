import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import net from "node:net";
import { loadServerModule } from "./helpers/inproc.js";
import { startRealServer } from "./helpers/real-server.js";

const { startServer } = await loadServerModule("lr-disconnect-");

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await Bun.sleep(25);
  }
  return predicate();
}

describe("client disconnect on a routes-hook stream", () => {
  let server;
  const state = { abortedAt: null, signal: null };

  beforeAll(async () => {
    server = await startServer({
      port: 0,
      hostname: "127.0.0.1",
      routes: {
        "/__endless": (req) => {
          state.signal = req.signal;
          req.signal.addEventListener("abort", () => {
            state.abortedAt = Date.now();
          });
          let timer;
          return new Response(
            new ReadableStream({
              start(controller) {
                timer = setInterval(() => controller.enqueue(new TextEncoder().encode("tick\n")), 50);
              },
              cancel() {
                clearInterval(timer);
              },
            }),
          );
        },
      },
    });
  });

  afterAll(() => {
    server.stop(true);
  });

  it("request.signal aborts within 1 s when the client disconnects mid-stream", async () => {
    const socket = net.connect(server.port, "127.0.0.1");
    await new Promise((resolve, reject) => {
      socket.once("data", resolve);
      socket.once("error", reject);
      socket.write("GET /__endless HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
    });
    expect(state.signal.aborted).toBe(false);
    const disconnectedAt = Date.now();
    socket.destroy();
    expect(await waitFor(() => state.abortedAt !== null, 1000)).toBe(true);
    expect(state.abortedAt - disconnectedAt).toBeLessThan(1000);
  });
});

describe("client disconnect on a real /v1 stream", () => {
  let real;

  beforeAll(async () => {
    real = await startRealServer();
  }, 60_000);

  afterAll(async () => {
    await real?.stop();
  });

  it("a /v1 stream abort closes the upstream mock connection", async () => {
    const controller = new AbortController();
    const res = await real.chat("pm/mock-endless-stream", { stream: true, signal: controller.signal });
    expect(res.status).toBe(200);
    const reader = res.body.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("data:");
    expect(real.mock.stats.cancelled).toBe(0);
    controller.abort();
    await reader.cancel().catch(() => {});
    expect(await waitFor(() => real.mock.stats.cancelled > 0, 3000)).toBe(true);
  }, 30_000);
});
