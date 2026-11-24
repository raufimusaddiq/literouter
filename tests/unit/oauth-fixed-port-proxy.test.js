import { describe, it, expect, afterEach } from "bun:test";
import { vi } from "#test/vi";
import http from "node:http";

vi.mock("@/models", () => ({
  createProviderConnection: vi.fn(async (data) => ({ id: "conn-1", email: "user@example.com", ...data })),
}));

const { createFixedPortProxy } = await import("../../src/lib/oauth/utils/server.js");

const SESSION = { state: "s1", codeVerifier: "verifier-1", redirectUri: "http://127.0.0.1:9/callback" };

const request = (port, path) =>
  new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path, agent: false }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const proxies = [];

function makeProxy(overrides = {}) {
  const exchange = vi.fn(async () => ({ access_token: "token-1", expiresIn: 3600 }));
  const proxy = createFixedPortProxy({
    provider: "test",
    port: 0,
    timeoutMs: 5000,
    exchange,
    ...overrides,
  });
  proxies.push(proxy);
  return { proxy, exchange };
}

afterEach(() => {
  while (proxies.length) proxies.pop().stop();
});

describe("createFixedPortProxy", () => {
  it("listens on an ephemeral port when given port 0", async () => {
    const { proxy } = makeProxy();

    const result = await proxy.start(7777);

    expect(result.success).toBe(true);
    expect(result.port).toBeGreaterThan(0);
  });

  it("exchanges the callback code and records the connection on the session", async () => {
    const { proxy, exchange } = makeProxy();
    const { port } = await proxy.start(7777);
    proxy.registerSession(SESSION);

    const response = await request(port, "/callback?code=code-1&state=s1");

    expect(response.status).toBe(200);
    expect(exchange).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "test", code: "code-1", state: "s1" }),
    );
    expect(proxy.getSession("s1")).toMatchObject({ status: "done", connectionId: "conn-1" });
  });

  it("records the provider error on the session when the exchange fails", async () => {
    const { proxy } = makeProxy({ exchange: async () => { throw new Error("bad code"); } });
    const { port } = await proxy.start(7777);
    proxy.registerSession(SESSION);

    const response = await request(port, "/callback?code=code-1&state=s1");

    expect(response.status).toBe(200);
    expect(proxy.getSession("s1")).toMatchObject({ status: "error", error: "bad code" });
  });

  it("redirects a callback with an unknown state to the app callback", async () => {
    const { proxy } = makeProxy();
    const { port } = await proxy.start(7777);

    const response = await request(port, "/callback?code=code-1&state=unknown");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("http://localhost:7777/callback?code=code-1&state=unknown");
  });

  it("answers 404 outside the callback paths", async () => {
    const { proxy } = makeProxy();
    const { port } = await proxy.start(7777);

    const response = await request(port, "/nope");

    expect(response.status).toBe(404);
  });

  it("stops listening once the timeout elapses", async () => {
    const { proxy } = makeProxy({ timeoutMs: 30 });
    const { port } = await proxy.start(7777);

    await sleep(120);

    await expect(request(port, "/callback?code=code-1&state=s1")).rejects.toThrow();
  });

  it("stops listening on stop()", async () => {
    const { proxy } = makeProxy();
    const { port } = await proxy.start(7777);

    proxy.stop();

    await expect(request(port, "/callback?code=code-1&state=s1")).rejects.toThrow();
  });
});
