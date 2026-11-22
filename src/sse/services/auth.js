import { getProviderConnections, getProviderConnectionById, validateApiKey, updateProviderConnection, mutateProviderConnection, getSettings, getProxyPools } from "@/lib/db/index.js";
import { resolveConnectionProxyConfig, pickProxyPoolId } from "@/lib/network/connectionProxy";
import { formatRetryAfter, checkFallbackError, shouldRotateAccount, isModelLockActive, buildModelLockUpdate, getEarliestModelLockUntil } from "open-sse/services/accountFallback.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { resolveProviderId, FREE_PROVIDERS } from "@/shared/constants/providers.js";
import { getAntigravityQuotaCache } from "./antigravityQuota.js";
import { extractClientApiKey } from "./keyAccess.js";
import * as log from "../utils/logger.js";

// Runtime-only round-robin cursor. Account rotation is request-serving state,
// not durable provider configuration: persisting it on every request caused a
// SQLite UPDATE, connection-cache invalidation, and Redis version bump for each
// successful selection. JavaScript executes the selection/update block below
// synchronously, so no async mutex is required inside one process.
const selectionState = globalThis.__liteRouterSelectionState ??= new Map();

function pickRoundRobinConnection(providerId, availableConnections, stickyLimit) {
  const compare = (a, b) => {
    const p = (a.priority || 999) - (b.priority || 999);
    return p || String(a.id).localeCompare(String(b.id));
  };
  // The pool arrives priority-sorted; only copy + re-sort when the id tiebreak
  // (or an unsorted caller) actually requires it. One O(n) pass, no allocation.
  let sorted = true;
  for (let i = 1; i < availableConnections.length; i++) {
    if (compare(availableConnections[i - 1], availableConnections[i]) > 0) { sorted = false; break; }
  }
  const ordered = sorted ? availableConnections : [...availableConnections].sort(compare);
  if (ordered.length === 0) return null;

  const limit = Math.max(1, Number.parseInt(stickyLimit, 10) || 1);
  const state = selectionState.get(providerId);
  const currentIndex = state
    ? ordered.findIndex((connection) => connection.id === state.connectionId)
    : -1;

  if (currentIndex >= 0 && state.consecutiveUseCount < limit) {
    const next = {
      connectionId: ordered[currentIndex].id,
      consecutiveUseCount: state.consecutiveUseCount + 1,
    };
    selectionState.set(providerId, next);
    return ordered[currentIndex];
  }

  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % ordered.length : 0;
  const connection = ordered[nextIndex];
  selectionState.set(providerId, {
    connectionId: connection.id,
    consecutiveUseCount: 1,
  });
  return connection;
}

export function resetProviderSelectionState(provider = null) {
  if (provider) selectionState.delete(resolveProviderId(provider));
  else selectionState.clear();
}

const GITHUB_MONTHLY_USAGE_LIMIT = "you've reached your additional usage limit for your plan";

function githubMonthlyResetMs(status, errorText, provider) {
  if (resolveProviderId(provider) !== "github" || Number(status) !== 402) return null;
  if (!String(errorText || "").toLowerCase().includes(GITHUB_MONTHLY_USAGE_LIMIT)) return null;
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

/**
 * Get provider credentials from localDb
 * Filters out unavailable accounts and returns the selected account based on strategy
 * @param {string} provider - Provider name
 * @param {Set<string>|string|null} excludeConnectionIds - Connection ID(s) to exclude (for retry with next account)
 * @param {string|null} model - Model name for per-model rate limit filtering
 */
export async function getProviderCredentials(provider, excludeConnectionIds = null, model = null, options = {}) {
  // Normalize to Set for consistent handling
  const excludeSet = excludeConnectionIds instanceof Set
    ? excludeConnectionIds
    : (excludeConnectionIds ? new Set([excludeConnectionIds]) : new Set());
  const preferredConnectionId = options?.preferredConnectionId || null;

  // Resolve alias to provider ID (e.g., "kc" -> "kilocode")
  const providerId = resolveProviderId(provider);

    // Inject a virtual connection for no-auth free providers (with optional proxy pool from settings)
    if (FREE_PROVIDERS[providerId]?.noAuth) {
      const settings = await getSettings();
      const override = (settings.providerStrategies || {})[providerId] || {};
      const strategy = override.rotateStrategy || "none";
      let pickedId = override.proxyPoolId || null;
      if (strategy !== "none") {
        const allPools = await getProxyPools({ isActive: true });
        const poolIds = allPools.filter(p => p.proxyUrl).map(p => p.id);
        pickedId = pickProxyPoolId(poolIds, strategy, providerId);
      }
      const resolvedProxy = await resolveConnectionProxyConfig({ proxyPoolId: pickedId || "" });
      return {
        id: "noauth",
        connectionName: "Public",
        isActive: true,
        accessToken: "public",
        providerSpecificData: {
          connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
          connectionProxyUrl: resolvedProxy.connectionProxyUrl,
          connectionNoProxy: resolvedProxy.connectionNoProxy,
          connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
          strictProxy: resolvedProxy.strictProxy === true,
          vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
        },
      };
    }

    const connections = await getProviderConnections({ provider: providerId, isActive: true }, { clone: false });
    const debugOn = process.env.LOG_LEVEL?.toUpperCase?.() === "DEBUG";
    if (debugOn) log.debug("AUTH", `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model || "any"}`);

    if (connections.length === 0) {
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }

    // Antigravity quota cache is lazy: only populated after that account returns 409/429.
    const isAntigravity = providerId === "antigravity";
    const antigravityQuotaCache = isAntigravity && model ? getAntigravityQuotaCache() : null;

    // Filter out model-locked, excluded, and Antigravity quota-exhausted connections.
    const availableConnections = connections.filter(c => {
      if (excludeSet.has(c.id)) return false;
      if (isModelLockActive(c, model)) return false;
      // Antigravity: skip if live quota exhausted for this model
      if (isAntigravity && model && antigravityQuotaCache) {
        const quota = antigravityQuotaCache.get(c.id)?.[model];
        if (quota && quota.remainingPercentage <= 0 && quota.resetAt && new Date(quota.resetAt).getTime() > Date.now()) {
          const account = c.id?.slice(0, 8) || "unknown";
          log.info("AG_QUOTA", `${account} | CACHE_BLOCK ${model} — skip upstream until ${quota.resetAt}`);
          return false;
        }
      }
      return true;
    });

    if (debugOn) log.debug("AUTH", `${provider} | available: ${availableConnections.length}/${connections.length}`);
    if (debugOn) connections.forEach(c => {
      const excluded = excludeSet.has(c.id);
      const locked = isModelLockActive(c, model);
      if (excluded || locked) {
        const lockUntil = getEarliestModelLockUntil(c);
        log.debug("AUTH", `  → ${c.id?.slice(0, 8)} | ${excluded ? "excluded" : ""} ${locked ? `modelLocked(${model}) until ${lockUntil}` : ""}`);
      }
    });

    if (availableConnections.length === 0) {
      // Find earliest persistent lock or lazy Antigravity quota-cache reset for retry timing.
      const lockedConns = connections.filter(c => isModelLockActive(c, model));
      const expiries = lockedConns.map(c => getEarliestModelLockUntil(c)).filter(Boolean);
      if (isAntigravity && model && antigravityQuotaCache) {
        connections.forEach((c) => {
          const resetAt = antigravityQuotaCache.get(c.id)?.[model]?.resetAt;
          if (resetAt && new Date(resetAt).getTime() > Date.now()) expiries.push(resetAt);
        });
      }
      const earliest = expiries.sort()[0] || null;
      if (earliest) {
        const earliestConn = lockedConns[0];
        log.warn("AUTH", `${provider} | all ${connections.length} accounts locked for ${model || "all"} (${formatRetryAfter(earliest)}) | lastError=${earliestConn?.lastError?.slice(0, 50)}`);
        return {
          allRateLimited: true,
          retryAfter: earliest,
          retryAfterHuman: formatRetryAfter(earliest),
          lastError: earliestConn?.lastError || null,
          lastErrorCode: earliestConn?.errorCode || null
        };
      }
      log.warn("AUTH", `${provider} | all ${connections.length} accounts unavailable`);
      return null;
    }

    const settings = await getSettings();
    // Per-provider strategy overrides global setting
    const providerOverride = (settings.providerStrategies || {})[providerId] || {};
    const strategy = providerOverride.fallbackStrategy || settings.fallbackStrategy || "fill-first";

    let connection;
    // Pin to preferred connection if specified and available
    if (preferredConnectionId) {
      connection = availableConnections.find((c) => c.id === preferredConnectionId);
      if (connection) {
        log.info("AUTH", `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`);
      }
    }
    if (connection) {
      // Preferred connection bypasses rotation.
    } else if (strategy === "round-robin") {
      const stickyLimit = providerOverride.stickyRoundRobinLimit || settings.stickyRoundRobinLimit || 3;
      connection = pickRoundRobinConnection(providerId, availableConnections, stickyLimit);
    } else {
      // Default: fill-first (already sorted by priority in getProviderConnections)
      connection = availableConnections[0];
    }

    const resolvedProxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});

    return {
      authType: connection.authType,
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      idToken: connection.idToken,
      expiresAt: connection.expiresAt,
      expiresIn: connection.expiresIn,
      lastRefreshAt: connection.lastRefreshAt,
      projectId: connection.projectId,
      connectionName: connection.displayName || connection.name || connection.email || connection.id,
      copilotToken: connection.providerSpecificData?.copilotToken,
      providerSpecificData: {
        ...(connection.providerSpecificData || {}),
        connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
        connectionProxyUrl: resolvedProxy.connectionProxyUrl,
        connectionNoProxy: resolvedProxy.connectionNoProxy,
        connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
        strictProxy: resolvedProxy.strictProxy === true,
        vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
      },
      connectionId: connection.id,
      // Include current status for optimization check
      testStatus: connection.testStatus,
      lastError: connection.lastError,
      // Pass full connection for clearAccountError to read modelLock_* keys
      _connection: connection
    };
}

/**
 * Mark account+model as unavailable — locks modelLock_${model} in DB.
 * All errors (429, 401, 5xx, etc.) lock per model, not per account.
 * @param {string} connectionId
 * @param {number} status - HTTP status code from upstream
 * @param {string} errorText
 * @param {string|null} provider
 * @param {string|null} model - The specific model that triggered the error
 * @returns {{ shouldFallback: boolean, cooldownMs: number }}
 */
export async function markAccountUnavailable(connectionId, status, errorText, provider = null, model = null, resetsAtMs = null) {
  if (!connectionId || connectionId === "noauth") return { shouldFallback: false, cooldownMs: 0 };
  // Read-only lookup (display name only); the backoff level itself is read inside
  // the write transaction below so concurrent failures cannot compute the same level.
  const conn = await getProviderConnectionById(connectionId, { clone: false });

  // GitHub premium-request exhaustion is account-wide until the next UTC month.
  const githubResetAtMs = githubMonthlyResetMs(status, errorText, provider);
  const reason = typeof errorText === "string" ? errorText.slice(0, 200) : "Provider error";

  let decision = { shouldFallback: false, cooldownMs: 0 };
  let lockUpdate = null;
  const stored = await mutateProviderConnection(connectionId, (existing) => {
    const backoffLevel = existing.backoffLevel || 0;
    // Provider-specific precise cooldown (e.g. codex usage_limit_reached resets_at) overrides backoff
    let shouldFallback, cooldownMs, newBackoffLevel;
    if (githubResetAtMs) {
      shouldFallback = true;
      cooldownMs = githubResetAtMs - Date.now();
      newBackoffLevel = 0;
    } else if (resetsAtMs && resetsAtMs > Date.now()) {
      shouldFallback = true;
      // Antigravity quota API provides exact per-model resetAt. Do not truncate it.
      cooldownMs = resolveProviderId(provider) === "antigravity"
        ? resetsAtMs - Date.now()
        : Math.min(resetsAtMs - Date.now(), MAX_RATE_LIMIT_COOLDOWN_MS);
      newBackoffLevel = 0;
    } else {
      const result = checkFallbackError(status, errorText, backoffLevel, provider);
      // Request/model-scoped failures say nothing about the credential: no lock, no
      // health write, and the caller must not rotate accounts for them.
      shouldFallback = shouldRotateAccount(result);
      cooldownMs = result.cooldownMs;
      newBackoffLevel = result.newBackoffLevel;
    }
    if (!shouldFallback) return null;
    decision = { shouldFallback: true, cooldownMs };
    lockUpdate = buildModelLockUpdate(githubResetAtMs ? null : model, cooldownMs);
    return {
      ...lockUpdate,
      testStatus: "unavailable",
      lastError: reason,
      errorCode: status,
      lastErrorAt: new Date().toISOString(),
      backoffLevel: newBackoffLevel ?? backoffLevel
    };
  });
  if (!decision.shouldFallback) return { shouldFallback: false, cooldownMs: 0 };
  // Connection vanished mid-flight: nothing to lock, but still rotate to another account.
  if (!stored || !lockUpdate) return decision;
  const cooldownMs = decision.cooldownMs;

  const lockKey = Object.keys(lockUpdate)[0];
  const connName = conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);
  log.warn("AUTH", `${connName} locked ${lockKey} for ${Math.round(cooldownMs / 1000)}s [${status}]`);

  if (provider && status && reason) {
    console.error(`❌ ${provider} [${status}]: ${reason}`);
  }

  return { shouldFallback: true, cooldownMs };
}

/**
 * Clear account error status on successful request.
 * - Clears modelLock_${model} (the model that just succeeded)
 * - Lazy-cleans any other expired modelLock_* keys
 * - Resets error state only if no active locks remain
 * @param {string} connectionId
 * @param {object} currentConnection - credentials object (has _connection) or raw connection
 * @param {string|null} model - model that succeeded
 */
export async function clearAccountError(connectionId, currentConnection, model = null) {
  if (!connectionId || connectionId === "noauth") return;
  const conn = currentConnection._connection || currentConnection;
  const now = Date.now();
  // Only locks with a value count: a null/empty key is a cleared lock, not a present one.
  const allLockKeys = Object.keys(conn).filter(k => k.startsWith("modelLock_") && conn[k]);

  if (!conn.testStatus && !conn.lastError && allLockKeys.length === 0) return;

  // Keys to clear: current model's lock + all expired locks
  const keysToClear = allLockKeys.filter(k => {
    if (model && k === `modelLock_${model}`) return true; // succeeded model
    if (model && k === "modelLock___all") return true;    // account-level lock
    return new Date(conn[k]).getTime() <= now;            // expired
  });

  // Healthy and nothing to clear: zero writes on the hot path.
  if (keysToClear.length === 0 && conn.testStatus !== "unavailable" && !conn.lastError) return;

  // Check if any active locks remain after clearing
  const remainingActiveLocks = allLockKeys.filter(k => {
    if (keysToClear.includes(k)) return false;
    return new Date(conn[k]).getTime() > now;
  });

  // null here means "delete the key": the repo prunes cleared modelLock_* entries.
  const clearObj = Object.fromEntries(keysToClear.map(k => [k, null]));

  // Only reset error state if no active locks remain
  if (remainingActiveLocks.length === 0) {
    Object.assign(clearObj, {
      testStatus: "active",
      lastError: null,
      errorCode: null,
      lastErrorAt: null,
      backoffLevel: 0
    });
  }

  await updateProviderConnection(connectionId, clearObj);
}

/**
 * Extract API key from the request.
 *
 * Delegates to the key-access extractor so auth and attribution read the key
 * from exactly the same places (Bearer, x-api-key, x-goog-api-key, ?key=).
 * A Gemini client that sends only `x-goog-api-key` must not look like "no key"
 * here while the middleware authorized it — that produced a 401 on /v1beta and
 * lost usage attribution.
 */
export function extractApiKey(request) {
  return extractClientApiKey(request);
}

/**
 * Validate API key (optional - for local use can skip)
 */
export async function isValidApiKey(apiKey) {
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}
