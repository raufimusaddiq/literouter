import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { vi } from "#test/vi";

vi.mock("../../open-sse/translator/concerns/image.js", async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    fetchImageAsBase64: vi.fn(async () => ({ url: "data:image/png;base64,QUJD", mimeType: "image/png" })),
  };
});

import { prefetchRemoteImages, clearPrefetchCacheForTests, PREFETCH_CONCURRENCY } from "../../open-sse/translator/concerns/prefetch.js";
import { fetchImageAsBase64 } from "../../open-sse/translator/concerns/image.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

beforeEach(() => { fetchImageAsBase64.mockClear(); clearPrefetchCacheForTests(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("prefetchRemoteImages", () => {
  it("no-op for targets that accept remote URLs (openai)", async () => {
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://x/a.png" } }] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OPENAI);
    expect(n).toBe(0);
    expect(body.messages[0].content[0].image_url.url).toBe("https://x/a.png");
  });

  it("openai source -> ollama target: converts remote URL to base64", async () => {
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://x/a.png" } }] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OLLAMA);
    expect(n).toBe(1);
    expect(body.messages[0].content[0].image_url.url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("skips data URI (already inline)", async () => {
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } }] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OLLAMA);
    expect(n).toBe(0);
    expect(fetchImageAsBase64).not.toHaveBeenCalled();
  });

  it("gemini source -> gemini target: fileData URL -> inlineData base64", async () => {
    const body = { contents: [{ role: "user", parts: [
      { fileData: { mimeType: "image/png", fileUri: "https://x/a.png" } },
    ] }] };
    const n = await prefetchRemoteImages(body, FORMATS.GEMINI, FORMATS.GEMINI);
    expect(n).toBe(1);
    expect(body.contents[0].parts[0].inlineData).toBeTruthy();
    expect(body.contents[0].parts[0].fileData).toBeUndefined();
  });

  it("claude source -> kiro target: source.url -> base64", async () => {
    const body = { messages: [{ role: "user", content: [
      { type: "image", source: { type: "url", url: "https://x/a.png" } },
    ] }] };
    const n = await prefetchRemoteImages(body, FORMATS.CLAUDE, FORMATS.KIRO);
    expect(n).toBe(1);
    expect(body.messages[0].content[0].source.type).toBe("base64");
  });

  it("openai source -> commandcode target: converts remote URL to base64", async () => {
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://x/a.png" } }] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.COMMANDCODE);
    expect(n).toBe(1);
    expect(body.messages[0].content[0].image_url.url.startsWith("data:image/png;base64,")).toBe(true);
    expect(fetchImageAsBase64).toHaveBeenCalled();
  });

  it("claude source -> commandcode target: source.url -> base64", async () => {
    const body = { messages: [{ role: "user", content: [
      { type: "image", source: { type: "url", url: "https://x/a.png" } },
    ] }] };
    const n = await prefetchRemoteImages(body, FORMATS.CLAUDE, FORMATS.COMMANDCODE);
    expect(n).toBe(1);
    expect(body.messages[0].content[0].source.type).toBe("base64");
  });
});

describe("prefetchRemoteImages concurrency / cache / signal", () => {
  const mk = (urls) => ({ messages: [{ role: "user", content: urls.map((u) => ({ type: "image_url", image_url: { url: u } })) }] });

  it("bounds concurrency", async () => {
    let active = 0, peak = 0;
    fetchImageAsBase64.mockImplementation(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { url: "data:image/png;base64,QUJD", mimeType: "image/png" };
    });
    const urls = Array.from({ length: 12 }, (_, i) => `https://x/${i}.png`);
    const n = await prefetchRemoteImages(mk(urls), FORMATS.OPENAI, FORMATS.OLLAMA);
    expect(n).toBe(12);
    expect(peak).toBeLessThanOrEqual(PREFETCH_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
  });

  it("caches by URL (dedupes within and across requests)", async () => {
    fetchImageAsBase64.mockImplementation(async () => ({ url: "data:image/png;base64,QUJD", mimeType: "image/png" }));
    const n = await prefetchRemoteImages(mk(["https://x/a.png", "https://x/a.png"]), FORMATS.OPENAI, FORMATS.OLLAMA);
    expect(n).toBe(2);
    expect(fetchImageAsBase64).toHaveBeenCalledTimes(1);
    await prefetchRemoteImages(mk(["https://x/a.png"]), FORMATS.OPENAI, FORMATS.OLLAMA);
    expect(fetchImageAsBase64).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures", async () => {
    fetchImageAsBase64.mockImplementation(async () => null);
    await prefetchRemoteImages(mk(["https://x/f.png"]), FORMATS.OPENAI, FORMATS.OLLAMA);
    await prefetchRemoteImages(mk(["https://x/f.png"]), FORMATS.OPENAI, FORMATS.OLLAMA);
    expect(fetchImageAsBase64).toHaveBeenCalledTimes(2);
  });

  it("passes a signal derived from the request signal and stops on abort", async () => {
    fetchImageAsBase64.mockImplementation(async () => ({ url: "data:image/png;base64,QUJD", mimeType: "image/png" }));
    const ac = new AbortController();
    await prefetchRemoteImages(mk(["https://x/s.png"]), FORMATS.OPENAI, FORMATS.OLLAMA, { signal: ac.signal });
    const passed = fetchImageAsBase64.mock.calls[0][1].signal;
    expect(passed).toBeInstanceOf(AbortSignal);
    ac.abort();
    expect(passed.aborted).toBe(true);

    fetchImageAsBase64.mockClear();
    const n = await prefetchRemoteImages(mk(["https://x/s2.png"]), FORMATS.OPENAI, FORMATS.OLLAMA, { signal: ac.signal });
    expect(n).toBe(0);
    expect(fetchImageAsBase64).not.toHaveBeenCalled();
  });
});
