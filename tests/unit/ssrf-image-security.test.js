import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { vi } from "#test/vi";

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...a) => lookupMock(...a) }));

import {
  isPrivateIp, fetchImageAsBase64, ImageLimitError, assertImageCount, createImageByteBudget, mapWithConcurrency,
} from "../../open-sse/translator/concerns/image.js";
import { prefetchRemoteImages, clearPrefetchCacheForTests } from "../../open-sse/translator/concerns/prefetch.js";
import { redactUrlSecrets } from "../../open-sse/utils/redactUrl.js";
import { MAX_REMOTE_IMAGES_PER_REQUEST } from "../../open-sse/config/mediaConfig.js";

const realFetch = globalThis.fetch;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function streamOf(bytes) {
  return { getReader() { let s = false; return { read: async () => s ? { done: true } : (s = true, { done: false, value: new Uint8Array(bytes) }), cancel: async () => {} }; } };
}

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  clearPrefetchCacheForTests();
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("isPrivateIp (BlockList)", () => {
  it.each([
    "0.0.0.0", "0.1.2.3", "10.1.1.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255",
    "192.0.0.5", "192.168.1.1", "198.18.0.1", "198.19.255.255", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "fc00::1", "fd12::1",
    "fe80::1", "fec0::1", "ff02::1", "fe80::1%eth0", "not-an-ip", "",
  ])("blocks %s", (ip) => { expect(isPrivateIp(ip)).toBe(true); });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.63.255.255", "198.20.0.1", "2606:4700:4700::1111", "2001:4860:4860::8888"])(
    "allows public %s", (ip) => { expect(isPrivateIp(ip)).toBe(false); });
});

describe("fetchImageAsBase64 redirects + pin", () => {
  it("does not follow a redirect to a private host", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 302, headers: new Headers({ location: "http://169.254.169.254/" }), body: null }));
    globalThis.fetch = f;
    expect(await fetchImageAsBase64("http://public.example/a.png")).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][1].redirect).toBe("manual");
  });

  it("passes a pinned dispatcher to fetch", async () => {
    const f = vi.fn(async () => ({ ok: true, body: streamOf(PNG) }));
    globalThis.fetch = f;
    expect(await fetchImageAsBase64("http://public.example/a.png")).not.toBeNull();
    expect(f.mock.calls[0][1].dispatcher).toBeDefined();
  });
});

describe("proxyAwareFetch dispatcher", () => {
  it("does not override a caller-supplied dispatcher", async () => {
    vi.resetModules();
    const f = vi.fn(async () => new Response("ok"));
    globalThis.fetch = f;
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    const dispatcher = { pinned: true };
    await proxyAwareFetch("https://example.com/x", { dispatcher });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][1].dispatcher).toBe(dispatcher);
  });
});

describe("image caps", () => {
  it("assertImageCount throws a 400 ImageLimitError over the cap", () => {
    expect(() => assertImageCount(MAX_REMOTE_IMAGES_PER_REQUEST)).not.toThrow();
    try { assertImageCount(MAX_REMOTE_IMAGES_PER_REQUEST + 1); expect.unreachable(); }
    catch (e) { expect(e).toBeInstanceOf(ImageLimitError); expect(e.status).toBe(400); expect(e.message).toMatch(/Image limit exceeded/); }
  });

  it("byte budget throws once total exceeds max", () => {
    const b = createImageByteBudget(100);
    b.add(60);
    expect(() => b.add(41)).toThrow(ImageLimitError);
  });

  it("mapWithConcurrency bounds in-flight work", async () => {
    let cur = 0, max = 0;
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      cur++; max = Math.max(max, cur); await new Promise((r) => setTimeout(r, 2)); cur--;
    });
    expect(max).toBeLessThanOrEqual(3);
  });

  it("prefetch rejects a request with too many remote images before fetching", async () => {
    const f = vi.fn();
    globalThis.fetch = f;
    const content = Array.from({ length: MAX_REMOTE_IMAGES_PER_REQUEST + 1 }, (_, i) => ({ type: "image_url", image_url: { url: `http://public.example/${i}.png` } }));
    await expect(prefetchRemoteImages({ messages: [{ role: "user", content }] }, "openai", "gemini")).rejects.toThrow(ImageLimitError);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("redactUrlSecrets", () => {
  it.each([
    ["https://x/y?key=SECRET", "https://x/y?key=[REDACTED]"],
    ["https://x/y?alt=sse&key=SECRET&z=1", "https://x/y?alt=sse&key=[REDACTED]&z=1"],
    ["https://x/y?api_key=S&access_token=T", "https://x/y?api_key=[REDACTED]&access_token=[REDACTED]"],
    ["→ https://x/y?KEY=S | body=3B", "→ https://x/y?KEY=[REDACTED] | body=3B"],
    ["https://x/y?monkey=1", "https://x/y?monkey=1"],
  ])("%s", (i, o) => { expect(redactUrlSecrets(i)).toBe(o); });
});
