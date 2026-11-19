// BaseExecutor: discarded retry responses are cancelled, retry sleeps honour the abort signal.
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { BaseExecutor } = await import("../../open-sse/executors/base.js");

function res(status, cancel = vi.fn().mockResolvedValue(undefined)) {
  return { status, headers: { get: () => "" }, body: { cancel } };
}

const creds = { apiKey: "k" };

beforeEach(() => fetchMock.mockReset());

describe("BaseExecutor.execute — discarded responses", () => {
  it("cancels the body of a response it retries", async () => {
    const ex = new BaseExecutor("test", { baseUrl: "https://x/api", retry: { 502: { attempts: 1, delayMs: 0 } } });
    const discarded = res(502);
    fetchMock.mockResolvedValueOnce(discarded).mockResolvedValueOnce(res(200));
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(200);
    expect(discarded.body.cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels the body of a response it abandons for a fallback url", async () => {
    const ex = new BaseExecutor("test", { baseUrls: ["https://a/api", "https://b/api"], retry: { 429: { attempts: 0 } } });
    const discarded = res(429);
    fetchMock.mockResolvedValueOnce(discarded).mockResolvedValueOnce(res(200));
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.url).toBe("https://b/api");
    expect(discarded.body.cancel).toHaveBeenCalledTimes(1);
  });
});

describe("BaseExecutor.execute — retry sleep is abortable", () => {
  it("rejects with AbortError instead of sleeping out the retry delay", async () => {
    const ex = new BaseExecutor("test", { baseUrl: "https://x/api", retry: { 502: { attempts: 3, delayMs: 30000 } } });
    fetchMock.mockResolvedValue(res(502));
    const ctrl = new AbortController();
    const started = Date.now();
    setTimeout(() => ctrl.abort(), 30);
    let thrown = null;
    try {
      await ex.execute({ model: "m", body: {}, stream: false, credentials: creds, signal: ctrl.signal });
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.name).toBe("AbortError");
    expect(Date.now() - started).toBeLessThan(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
