export function createTtlLruMap(
  globalKey,
  { maxSize = 1000, ttlMs = 0, cleanupIntervalMs = 0 } = {},
) {
  const hasGlobalKey = typeof globalKey === "string" && globalKey.length > 0;
  let state;
  if (hasGlobalKey) {
    const stores = (globalThis.__liteRouterTtlLruStores ??= new Map());
    state = stores.get(globalKey);
    if (!state) {
      state = { map: new Map(), ttlMs };
      stores.set(globalKey, state);
    } else {
      state.ttlMs = ttlMs;
    }
  } else {
    state = { map: new Map(), ttlMs };
  }

  const prune = (now = Date.now()) => {
    if (state.ttlMs <= 0) return 0;
    let removed = 0;
    for (const [key, item] of state.map) {
      if (now - item.lastUsed > state.ttlMs) {
        state.map.delete(key);
        removed++;
      }
    }
    return removed;
  };

  if (hasGlobalKey && ttlMs > 0 && cleanupIntervalMs > 0) {
    const timers = (globalThis.__liteRouterTtlLruTimers ??= new Map());
    let record = timers.get(cleanupIntervalMs);
    if (!record) {
      const keys = new Set([globalKey]);
      const timer = setInterval(() => {
        const stores = globalThis.__liteRouterTtlLruStores;
        if (!stores) return;
        const now = Date.now();
        for (const k of keys) {
          const entry = stores.get(k);
          if (!entry) {
            keys.delete(k);
            continue;
          }
          if (entry.ttlMs <= 0) continue;
          for (const [itemKey, item] of entry.map) {
            if (now - item.lastUsed > entry.ttlMs) {
              entry.map.delete(itemKey);
            }
          }
        }
        if (keys.size === 0) {
          clearInterval(timer);
          timers.delete(cleanupIntervalMs);
        }
      }, cleanupIntervalMs);
      timer.unref?.();
      record = { timer, keys };
      timers.set(cleanupIntervalMs, record);
    } else {
      record.keys.add(globalKey);
    }
  }

  return {
    get(key, now = Date.now()) {
      const item = state.map.get(key);
      if (!item) return undefined;
      if (state.ttlMs > 0 && now - item.lastUsed > state.ttlMs) {
        state.map.delete(key);
        return undefined;
      }
      item.lastUsed = now;
      state.map.delete(key);
      state.map.set(key, item);
      return item.value;
    },
    peek(key, now = Date.now()) {
      const item = state.map.get(key);
      if (!item) return undefined;
      if (state.ttlMs > 0 && now - item.lastUsed > state.ttlMs) {
        state.map.delete(key);
        return undefined;
      }
      return item.value;
    },
    set(key, value, now = Date.now()) {
      if (state.map.has(key)) {
        state.map.delete(key);
      } else {
        while (maxSize > 0 && state.map.size >= maxSize) {
          const oldest = state.map.keys().next().value;
          if (oldest === undefined) break;
          state.map.delete(oldest);
        }
      }
      state.map.set(key, { value, lastUsed: now });
      return this;
    },
    delete(key) {
      return state.map.delete(key);
    },
    clear() {
      state.map.clear();
    },
    *entries(now = Date.now()) {
      for (const [key, item] of state.map) {
        if (state.ttlMs > 0 && now - item.lastUsed > state.ttlMs) {
          state.map.delete(key);
          continue;
        }
        yield [key, item.value];
      }
    },
    [Symbol.iterator]() {
      return this.entries();
    },
    prune,
    dispose() {
      state.map.clear();
      if (!hasGlobalKey) return;
      globalThis.__liteRouterTtlLruStores?.delete(globalKey);
      const timers = globalThis.__liteRouterTtlLruTimers;
      if (!timers) return;
      for (const [interval, record] of timers) {
        record.keys.delete(globalKey);
        if (record.keys.size === 0) {
          clearInterval(record.timer);
          timers.delete(interval);
        }
      }
    },
    get size() {
      return state.map.size;
    },
  };
}
