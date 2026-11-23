import { describe, it, expect, beforeEach } from "bun:test";
import { vi } from "#test/vi";

describe("proxied fetch", () => {
  beforeEach(() => { vi.resetModules(); });

  it("passes each normalized proxy URL to fetch without leaking state across many proxies", async () => {
    const realFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = vi.fn(async (_u, o) => { calls.push(o.proxy); return new Response("ok"); });
    try {
      const { MEMORY_CONFIG } = await import("../../open-sse/config/runtimeConfig.js");
      const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
      const max = MEMORY_CONFIG.proxyDispatchersMaxSize;
      for (let i = 0; i <= max; i++) {
        await proxyAwareFetch("https://example.invalid/x", {}, { enabled: true, url: `http://127.0.0.1:${9000 + i}` });
      }
      expect(calls).toHaveLength(max + 1);
      expect(calls.every((p, i) => p === `http://127.0.0.1:${9000 + i}`)).toBe(true);
    } finally { globalThis.fetch = realFetch; }
  });
});
