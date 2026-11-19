import { describe, it, expect, vi } from "vitest";
import { withTimeout, runWithConcurrency, createTtlCache, TimeoutError } from "@/lib/asyncLimits.js";

describe("runWithConcurrency", () => {
  it("never exceeds the limit and preserves order", async () => {
    let active = 0, peak = 0;
    const res = await runWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(peak).toBe(4);
    expect(res.map((r) => r.value)).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });
  it("isolates failures", async () => {
    const res = await runWithConcurrency([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error("x"); return n; });
    expect(res.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
  it("handles empty input", async () => {
    expect(await runWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe("withTimeout", () => {
  it("resolves fast work", async () => {
    expect(await withTimeout(async () => "ok", 100)).toBe("ok");
  });
  it("rejects with TimeoutError and aborts the signal", async () => {
    let sig;
    const p = withTimeout((s) => { sig = s; return new Promise(() => {}); }, 20, "Quota");
    await expect(p).rejects.toBeInstanceOf(TimeoutError);
    expect(sig.aborted).toBe(true);
  });
});

describe("createTtlCache", () => {
  it("serves cached value within ttl and reloads after", async () => {
    let t = 0;
    const cache = createTtlCache({ ttlMs: 30000, now: () => t });
    const loader = vi.fn(async () => ({ n: 1 }));
    await cache.get("a", loader);
    t = 29000;
    await cache.get("a", loader);
    expect(loader).toHaveBeenCalledTimes(1);
    t = 31000;
    await cache.get("a", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
  it("keys by connection and dedupes in-flight loads", async () => {
    const cache = createTtlCache({ ttlMs: 1000 });
    const loader = vi.fn(async () => { await new Promise((r) => setTimeout(r, 10)); return 1; });
    await Promise.all([cache.get("a", loader), cache.get("a", loader), cache.get("b", loader)]);
    expect(loader).toHaveBeenCalledTimes(2);
  });
  it("bypass refreshes, does not cache failures or rejected shouldCache", async () => {
    const cache = createTtlCache({ ttlMs: 1000 });
    const loader = vi.fn(async () => 1);
    await cache.get("a", loader);
    await cache.get("a", loader, { bypass: true });
    expect(loader).toHaveBeenCalledTimes(2);
    const bad = vi.fn(async () => { throw new Error("no"); });
    await expect(cache.get("f", bad)).rejects.toThrow();
    await expect(cache.get("f", bad)).rejects.toThrow();
    expect(bad).toHaveBeenCalledTimes(2);
    const err = vi.fn(async () => ({ error: "x" }));
    await cache.get("e", err, { shouldCache: (v) => !v.error });
    await cache.get("e", err, { shouldCache: (v) => !v.error });
    expect(err).toHaveBeenCalledTimes(2);
  });
});
