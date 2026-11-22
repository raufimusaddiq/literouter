const REFRESH_RESULT_TTL_MS = 10_000;
const refreshDedupCache = new Map();

// Results are keyed by the consumed (old) token, which rotating providers never
// send again — drop expired results so the map does not grow per refresh.
function pruneExpired(now) {
  for (const [key, entry] of refreshDedupCache) {
    if (!entry.promise && entry.expiresAt <= now) refreshDedupCache.delete(key);
  }
}

export async function dedupRefresh(provider, oldToken, fn, log) {
  if (!oldToken) return fn();
  const key = `${provider}:${oldToken}`;
  const hit = refreshDedupCache.get(key);
  if (hit) {
    if (hit.promise) {
      log?.info?.("TOKEN_REFRESH", `Reusing in-flight refresh for ${provider}`);
      return hit.promise;
    }
    if (hit.expiresAt > Date.now()) {
      log?.info?.("TOKEN_REFRESH", `Reusing recent refresh result for ${provider}`);
      return hit.result;
    }
    refreshDedupCache.delete(key);
  }
  pruneExpired(Date.now());
  const promise = (async () => {
    try {
      const result = await fn();
      refreshDedupCache.set(key, { result, expiresAt: Date.now() + REFRESH_RESULT_TTL_MS });
      return result;
    } catch (err) {
      refreshDedupCache.delete(key);
      throw err;
    }
  })();
  refreshDedupCache.set(key, { promise });
  return promise;
}
