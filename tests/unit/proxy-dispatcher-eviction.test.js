import { describe, it, expect, beforeEach } from "bun:test";
import { vi } from "#test/vi";

const closed = [];
vi.mock("undici", async (orig) => {
  const actual = await orig();
  class ProxyAgent {
    constructor(o) { this.uri = o.uri; }
    async close() { closed.push(this.uri); }
  }
  return { ...actual, ProxyAgent };
});

describe("proxy dispatcher eviction", () => {
  beforeEach(() => { closed.length = 0; vi.resetModules(); });

  it("closes the evicted ProxyAgent", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("ok"));
    try {
      const { MEMORY_CONFIG } = await import("../../open-sse/config/runtimeConfig.js");
      const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
      const max = MEMORY_CONFIG.proxyDispatchersMaxSize;
      for (let i = 0; i <= max; i++) {
        await proxyAwareFetch("https://example.invalid/x", {}, { enabled: true, url: `http://127.0.0.1:${9000 + i}` });
      }
      expect(closed).toEqual(["http://127.0.0.1:9000"]);
    } finally { globalThis.fetch = realFetch; }
  });
});
