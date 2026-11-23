import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { vi } from "#test/vi";

const staleErr = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) });

describe("stale socket classification", () => {
  it("flags socket-death errors, never DNS/refused/abort/bare fetch failed", async () => {
    const { isStaleSocketError } = await import("../../open-sse/utils/proxyFetch.js");
    expect(isStaleSocketError(staleErr())).toBe(true);
    expect(isStaleSocketError(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(true);
    expect(isStaleSocketError(new Error("socket hang up"))).toBe(true);
    expect(isStaleSocketError(Object.assign(new Error("x"), { cause: { code: "ENOTFOUND" } }))).toBe(false);
    expect(isStaleSocketError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe(false);
    expect(isStaleSocketError(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(false);
    expect(isStaleSocketError(new TypeError("fetch failed"))).toBe(false);
    expect(isStaleSocketError(Object.assign(new Error("x"), { cause: { code: "UND_ERR_HEADERS_TIMEOUT" } }))).toBe(false);
  });
});

describe("keep-alive timeouts", () => {
  it("are gone: Bun's fetch has no keep-alive TTL to cap", async () => {
    const config = await import("../../open-sse/config/runtimeConfig.js");
    expect(config.resolveKeepAliveTimeouts).toBeUndefined();
    expect(config.FETCH_KEEPALIVE_TIMEOUT_MS).toBeUndefined();
    expect(config.DEFAULT_KEEPALIVE_TIMEOUT_MS).toBeUndefined();
    expect(config.FRESH_RETRY_KEEPALIVE_TIMEOUT_MS).toBeUndefined();
  });
});

describe("direct fetch replay", () => {
  let realFetch;
  beforeEach(() => { realFetch = globalThis.fetch; vi.resetModules(); });
  afterEach(() => { globalThis.fetch = realFetch; delete process.env.FETCH_FRESH_RETRY; });

  it("replays once on a fresh socket when a pooled socket died", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (_u, o) => { calls.push(o.keepalive); if (calls.length === 1) throw staleErr(); return new Response("ok"); });
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    const res = await proxyAwareFetch("https://example.invalid/v1", { method: "POST", body: "{}" });
    expect(await res.text()).toBe("ok");
    expect(calls).toEqual([undefined, false]);
  });

  it("never replays a stream body", async () => {
    const spy = vi.fn(async () => { throw staleErr(); });
    globalThis.fetch = spy;
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.close(); } });
    await expect(proxyAwareFetch("https://example.invalid/v1", { method: "POST", body, duplex: "half" })).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not replay a bare fetch failed", async () => {
    const spy = vi.fn(async () => { throw new TypeError("fetch failed"); });
    globalThis.fetch = spy;
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    await expect(proxyAwareFetch("https://example.invalid/v1", { method: "POST", body: "{}" })).rejects.toThrow("fetch failed");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("FETCH_FRESH_RETRY=off disables the replay", async () => {
    process.env.FETCH_FRESH_RETRY = "off";
    const spy = vi.fn(async () => { throw staleErr(); });
    globalThis.fetch = spy;
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    await expect(proxyAwareFetch("https://example.invalid/v1", { method: "POST", body: "{}" })).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("forceFreshSocket goes straight to a fresh socket", async () => {
    const seen = [];
    globalThis.fetch = vi.fn(async (_u, o) => { seen.push(o.keepalive); return new Response("ok"); });
    const mod = await import("../../open-sse/utils/proxyFetch.js");
    await mod.proxyAwareFetch("https://example.invalid/v1", { method: "POST", body: "{}" }, { forceFreshSocket: true });
    expect(seen).toEqual([false]);
  });
});
