import { describe, it, expect, afterAll } from "bun:test";
import http from "node:http";

process.env.REFRESH_TIMEOUT_MS = "300";
const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
const { PROVIDERS } = await import("../../open-sse/config/providers.js");
const { refreshAccessToken } = await import("../../open-sse/services/tokenRefresh/providers.js");
const { REFRESH_TIMEOUT_MS } = await import("../../open-sse/config/runtimeConfig.js");
const { refreshSignal } = await import("../../open-sse/utils/requestTimeouts.js");

const sockets = new Set();
const server = http.createServer(() => {});
server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const hung = `http://127.0.0.1:${server.address().port}/token`;

afterAll(async () => {
  for (const s of sockets) s.destroy();
  await new Promise((r) => server.close(r));
});

describe("refresh timeout", () => {
  it("is env-configurable", () => expect(REFRESH_TIMEOUT_MS).toBe(300));

  it("refreshSignal combines with the client signal", () => {
    const c = new AbortController();
    const s = refreshSignal(c.signal);
    expect(s.aborted).toBe(false);
    c.abort();
    expect(s.aborted).toBe(true);
  });

  it("DefaultExecutor refresh against a hung endpoint fails (null) at the timeout", async () => {
    const orig = PROVIDERS.kiro.tokenUrl;
    PROVIDERS.kiro.tokenUrl = hung;
    try {
      const t0 = Date.now();
      const out = await new DefaultExecutor("kiro").refreshCredentials({ refreshToken: "r" }, null);
      expect(out).toBeNull();
      expect(Date.now() - t0).toBeLessThan(5000);
    } finally { PROVIDERS.kiro.tokenUrl = orig; }
  });

  it("refreshAccessToken against a hung endpoint returns null at the timeout", async () => {
    const orig = PROVIDERS.kimi?.refreshUrl;
    const prov = PROVIDERS.kimi ? "kimi" : "claude";
    const cfg = PROVIDERS[prov];
    const key = cfg.refreshUrl !== undefined ? "refreshUrl" : "tokenUrl";
    const old = cfg[key];
    cfg[key] = hung;
    try {
      const t0 = Date.now();
      const out = await refreshAccessToken(prov, "r", {}, null);
      expect(out).toBeNull();
      expect(Date.now() - t0).toBeLessThan(5000);
    } finally { cfg[key] = old; void orig; }
  });
});
