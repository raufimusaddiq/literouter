import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { loadServerModule } from "./helpers/inproc.js";
import { startRealServer } from "./helpers/real-server.js";

process.env.MOCK_STREAM_PAUSE_MS = "16000";
process.env.MOCK_JSON_DELAY_MS = "12000";

const { startServer } = await loadServerModule("lr-timeouts-");
const { routeTable } = await import("../../src/server/routes.js");

const SILENCE_TEST_TIMEOUT_MS = 40_000;

describe("idle timeout wiring", () => {
  const stubbed = new Map();
  const servers = [];

  function stubRoute(path, load) {
    const entry = routeTable.find((e) => e.path === path);
    stubbed.set(entry, entry.load);
    entry.load = load;
  }

  function silentStream() {
    return new Response(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode("a"));
          await Bun.sleep(5000);
          controller.enqueue(new TextEncoder().encode("b"));
          controller.close();
        },
      }),
    );
  }

  beforeAll(() => {
    stubRoute("/v1/chat/completions", async () => ({ POST: async () => silentStream() }));
    stubRoute("/api/health", async () => ({ GET: async () => silentStream() }));
  });

  afterAll(() => {
    for (const s of servers) s.stop(true);
    for (const [entry, load] of stubbed) entry.load = load;
  });

  it("idleTimeout is 255", async () => {
    const spy = spyOn(Bun, "serve");
    try {
      const server = await startServer({ port: 0, hostname: "127.0.0.1" });
      servers.push(server);
      expect(spy.mock.calls[0][0].idleTimeout).toBe(255);
    } finally {
      spy.mockRestore();
    }
  });

  it("a long-lived route survives silence longer than the idle timeout", async () => {
    const server = await startServer({ port: 0, hostname: "127.0.0.1", idleTimeout: 2 });
    servers.push(server);
    const res = await fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, { method: "POST", body: "{}" });
    expect(await res.text()).toBe("ab");
  }, SILENCE_TEST_TIMEOUT_MS);

  it("a regular route is cut once it is silent past the idle timeout", async () => {
    const server = await startServer({ port: 0, hostname: "127.0.0.1", idleTimeout: 2 });
    servers.push(server);
    let outcome;
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/health`);
      outcome = await res.text();
    } catch (err) {
      outcome = err.code ?? err.message;
    }
    expect(outcome).not.toBe("ab");
  }, SILENCE_TEST_TIMEOUT_MS);
});

describe("real server with the default idle timeout", () => {
  let real;

  beforeAll(async () => {
    real = await startRealServer();
  }, 60_000);

  afterAll(async () => {
    await real?.stop();
  });

  it.concurrent("a /v1 stream silent for 16 s is not cut", async () => {
    const started = Date.now();
    const res = await real.chat("pm/mock-slow-stream", { stream: true });
    expect(res.status).toBe(200);
    const reader = res.body.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("par");
    const rest = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest.push(new TextDecoder().decode(value));
    }
    expect(Date.now() - started).toBeGreaterThanOrEqual(15_000);
    expect(rest.join("")).toContain("ity");
    expect(rest.join("")).toContain("[DONE]");
  }, SILENCE_TEST_TIMEOUT_MS);

  it.concurrent("a non-stream /v1 call that takes 12 s completes", async () => {
    const started = Date.now();
    const res = await real.chat("pm/mock-slow-json");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.choices[0].message.content).toBe("parity ok");
    expect(Date.now() - started).toBeGreaterThanOrEqual(11_000);
  }, SILENCE_TEST_TIMEOUT_MS);

  it.concurrent("console-logs/stream stays open with no log traffic for 12 s", async () => {
    const res = await fetch(`${real.baseUrl}/api/console-logs/stream`, { headers: real.cliHeaders });
    expect(res.status).toBe(200);
    const reader = res.body.getReader();
    const deadline = Date.now() + 12_000;
    let ended = false;
    while (Date.now() < deadline) {
      const outcome = await Promise.race([reader.read(), Bun.sleep(deadline - Date.now()).then(() => "timer")]);
      if (outcome !== "timer" && outcome.done) {
        ended = true;
        break;
      }
    }
    await reader.cancel();
    expect(ended).toBe(false);
  }, SILENCE_TEST_TIMEOUT_MS);
});
