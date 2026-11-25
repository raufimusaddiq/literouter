import { afterEach, describe, expect, it } from "bun:test";
import { createTtlLruMap } from "../../open-sse/utils/ttlLruMap.js";

const createdKeys = [];
const createdIntervals = [];

function makeTestStore(key, opts) {
  createdKeys.push(key);
  if (opts?.cleanupIntervalMs > 0) createdIntervals.push(opts.cleanupIntervalMs);
  return createTtlLruMap(key, opts);
}

afterEach(() => {
  const stores = globalThis.__liteRouterTtlLruStores;
  const timers = globalThis.__liteRouterTtlLruTimers;
  for (const interval of createdIntervals.splice(0)) {
    const rec = timers?.get(interval);
    if (rec) {
      for (const k of createdKeys) rec.keys.delete(k);
      if (rec.keys.size === 0) {
        clearInterval(rec.timer);
        timers.delete(interval);
      }
    }
  }
  for (const k of createdKeys.splice(0)) {
    stores?.delete(k);
  }
});

describe("createTtlLruMap", () => {
  it("refreshes recency on get and evicts the least recently used entry at maxSize", () => {
    const store = makeTestStore("test:lru", { maxSize: 2, ttlMs: 0 });
    store.set("a", 1, 100);
    store.set("b", 2, 100);
    expect(store.get("a", 110)).toBe(1);

    store.set("c", 3, 120);
    expect(store.get("b", 120)).toBeUndefined();
    expect(store.get("a", 120)).toBe(1);
    expect(store.get("c", 120)).toBe(3);

    store.set("a", 10, 130);
    expect(store.size).toBe(2);
    expect(store.get("c", 130)).toBe(3);
  });

  it("expires entries by TTL on get, peek, and prune without mutating recency on peek", () => {
    const store = makeTestStore("test:ttl", { maxSize: 3, ttlMs: 50 });
    store.set("a", "first", 100);
    store.set("b", "second", 120);

    expect(store.peek("a", 130)).toBe("first");
    expect(store.get("a", 151)).toBeUndefined();
    expect(store.peek("b", 160)).toBe("second");
    expect(store.prune(171)).toBe(1);
    expect(store.size).toBe(0);
  });

  it("never expires entries when ttlMs is 0 and supports Map-style iteration", () => {
    const store = makeTestStore("test:no-ttl", { maxSize: 2, ttlMs: 0 });
    store.set("k", "v", 1);
    expect(store.prune(1_000_000)).toBe(0);
    expect(store.get("k", 1_000_000)).toBe("v");
    expect([...store]).toEqual([["k", "v"]]);
  });

  it("reuses the globalThis backing store and shares one sweep timer per interval", () => {
    const interval = 60_000 + Math.floor(Math.random() * 1000);
    const first = makeTestStore("test:global-a", { maxSize: 5, ttlMs: 1000, cleanupIntervalMs: interval });
    first.set("k", "val", 10);

    const second = makeTestStore("test:global-a", { maxSize: 5, ttlMs: 2000, cleanupIntervalMs: interval });
    const third = makeTestStore("test:global-b", { maxSize: 5, ttlMs: 2000, cleanupIntervalMs: interval });

    expect(second.get("k", 20)).toBe("val");
    expect(third.size).toBe(0);
    const record = globalThis.__liteRouterTtlLruTimers.get(interval);
    expect(record.keys.has("test:global-a")).toBe(true);
    expect(record.keys.has("test:global-b")).toBe(true);
  });

  it("removes global state and stops the shared timer once all stores using it are disposed", () => {
    const interval = 70_000 + Math.floor(Math.random() * 1000);
    const first = makeTestStore("test:dispose-a", { maxSize: 4, ttlMs: 1000, cleanupIntervalMs: interval });
    const second = makeTestStore("test:dispose-b", { maxSize: 4, ttlMs: 1000, cleanupIntervalMs: interval });
    first.set("x", 1, 10);

    first.dispose();
    expect(globalThis.__liteRouterTtlLruStores.has("test:dispose-a")).toBe(false);
    expect(globalThis.__liteRouterTtlLruTimers.get(interval)?.keys.has("test:dispose-a")).toBe(false);
    expect(globalThis.__liteRouterTtlLruTimers.has(interval)).toBe(true);

    second.dispose();
    expect(globalThis.__liteRouterTtlLruStores.has("test:dispose-b")).toBe(false);
    expect(globalThis.__liteRouterTtlLruTimers.has(interval)).toBe(false);
  });
});
