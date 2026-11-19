// In-memory, bounded failed-auth throttle for the public gateway routes.
// Counts only failed key validations per client IP. Lenient on purpose: behind
// Cloudflare without Caddy `trusted_proxies`, many users can share one edge IP.
const MAX_FAILS = Number(process.env.API_KEY_FAIL_LIMIT) > 0 ? Number(process.env.API_KEY_FAIL_LIMIT) : 20;
const WINDOW_MS = 60_000;
const BLOCK_MS = 60_000;
const MAX_ENTRIES = 10_000;

const store = (globalThis.__liteRouterKeyThrottle ??= new Map()); // ip -> { count, windowStart, blockedUntil }

function evict(now) {
  for (const [ip, e] of store) {
    if (e.blockedUntil <= now && now - e.windowStart > WINDOW_MS) store.delete(ip);
  }
  // Still full: drop oldest-inserted entries (Map preserves insertion order).
  while (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
}

export function checkApiKeyThrottle(ip, now = Date.now()) {
  const e = store.get(ip);
  if (!e || e.blockedUntil <= now) return { blocked: false };
  return { blocked: true, retryAfter: Math.ceil((e.blockedUntil - now) / 1000) };
}

export function recordApiKeyFailure(ip, now = Date.now()) {
  let e = store.get(ip);
  if (!e || (e.blockedUntil <= now && now - e.windowStart > WINDOW_MS)) {
    if (!e && store.size >= MAX_ENTRIES) evict(now);
    e = { count: 0, windowStart: now, blockedUntil: 0 };
  }
  e.count += 1;
  if (e.count >= MAX_FAILS && e.blockedUntil <= now) {
    e.blockedUntil = now + BLOCK_MS;
    e.count = 0;
    e.windowStart = now;
  }
  store.delete(ip); // re-insert so the Map stays ordered by recency
  store.set(ip, e);
}

export function resetApiKeyThrottle() { store.clear(); }
export const __limits = { MAX_FAILS, WINDOW_MS, BLOCK_MS, MAX_ENTRIES };
export function throttleSize() { return store.size; }
