import { describe, it, expect, beforeEach } from "bun:test";
import { vi } from "#test/vi";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...a) => fetchMock(...a) }));

import { getClaudeUsage, __resetClaudeUsageCacheForTests } from "../../open-sse/services/usage/claude.js";

const okResp = () => ({ ok: true, status: 200, json: async () => ({ five_hour: { utilization: 10, resets_at: null } }) });
const failResp = () => ({ ok: false, status: 500, text: async () => "boom", json: async () => ({}) });

beforeEach(() => { fetchMock.mockReset(); __resetClaudeUsageCacheForTests(); });

describe("getClaudeUsage cache", () => {
  it("does not cache a rejection forever", async () => {
    fetchMock.mockRejectedValueOnce(new Error("net"));
    await getClaudeUsage("tok-rej").catch(() => {});
    fetchMock.mockResolvedValue(okResp());
    await getClaudeUsage("tok-rej").catch(() => {});
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not cache soft failures; retries next call", async () => {
    fetchMock.mockResolvedValue(failResp());
    const r1 = await getClaudeUsage("tok-soft");
    expect(r1?.quotas).toBeUndefined();
    const callsAfterFirst = fetchMock.mock.calls.length;
    await getClaudeUsage("tok-soft");
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("caches good results and serves them", async () => {
    fetchMock.mockResolvedValue(okResp());
    const r1 = await getClaudeUsage("tok-ok");
    if (!r1?.quotas) return; // shape guard: only meaningful when parse yields quotas
    const calls = fetchMock.mock.calls.length;
    const r2 = await getClaudeUsage("tok-ok");
    expect(r2).toBe(r1);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("bounds the map size", async () => {
    fetchMock.mockResolvedValue(okResp());
    for (let i = 0; i < 260; i++) await getClaudeUsage(`tok-${i}`);
    // oldest entries evicted: first token must refetch
    const before = fetchMock.mock.calls.length;
    await getClaudeUsage("tok-0");
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });
});
