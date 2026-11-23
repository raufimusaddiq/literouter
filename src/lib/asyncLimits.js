
export class TimeoutError extends Error {
  constructor(ms, label = "Request") {
    super(`${label} timed out after ${Math.round(ms / 1000)}s`);
    this.name = "TimeoutError";
    this.timeoutMs = ms;
  }
}

export async function withTimeout(fn, ms, label) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(ms, label));
    }, ms);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => fn(controller.signal)), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await worker(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  const lanes = Math.max(1, Math.min(limit | 0 || 1, items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}

export function createTtlCache({ ttlMs, now = Date.now, maxEntries = 500 }) {
  const store = new Map();
  const inflight = new Map();

  async function get(key, loader, { bypass = false, shouldCache = () => true } = {}) {
    if (!bypass) {
      const hit = store.get(key);
      if (hit && hit.expiresAt > now()) return hit.value;
      if (inflight.has(key)) return inflight.get(key);
    }
    const p = (async () => {
      try {
        const value = await loader();
        if (shouldCache(value)) {
          if (store.size >= maxEntries) store.delete(store.keys().next().value);
          store.set(key, { value, expiresAt: now() + ttlMs });
        }
        return value;
      } finally {
        if (inflight.get(key) === p) inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  return { get, delete: (k) => store.delete(k), clear: () => store.clear() };
}
