import { getProviderConnections, getProviderConnectionById, validateApiKey, updateProviderConnection, mutateProviderConnection, getSettings, getProxyPools } from "@/lib/db/index.js";
import { resolveConnectionProxyConfig, pickProxyPoolId } from "@/lib/network/connectionProxy";
import { formatRetryAfter, checkFallbackError, shouldRotateAccount, isModelLockActive, buildModelLockUpdate, getEarliestModelLockUntil } from "open-sse/services/accountFallback.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { resolveProviderId, FREE_PROVIDERS } from "@/shared/constants/providers.js";
import { getAntigravityQuotaCache } from "./antigravityQuota.js";
import { extractClientApiKey } from "./keyAccess.js";
import * as log from "../utils/logger.js";

const selectionState = globalThis.__liteRouterSelectionState ??= new Map();

function pickRoundRobinConnection(providerId, availableConnections, stickyLimit) {
  const compare = (a, b) => {
    const p = (a.priority || 999) - (b.priority || 999);
    return p || String(a.id).localeCompare(String(b.id));
  };
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

export async function getProviderCredentials(provider, excludeConnectionIds = null, model = null, options = {}) {
  const excludeSet = excludeConnectionIds instanceof Set
    ? excludeConnectionIds
    : (excludeConnectionIds ? new Set([excludeConnectionIds]) : new Set());
  const preferredConnectionId = options?.preferredConnectionId || null;

  const providerId = resolveProviderId(provider);

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

    const isAntigravity = providerId === "antigravity";
    const antigravityQuotaCache = isAntigravity && model ? getAntigravityQuotaCache() : null;

    const availableConnections = connections.filter(c => {
      if (excludeSet.has(c.id)) return false;
      if (isModelLockActive(c, model)) return false;
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
    const providerOverride = (settings.providerStrategies || {})[providerId] || {};
    const strategy = providerOverride.fallbackStrategy || settings.fallbackStrategy || "fill-first";

    let connection;
    if (preferredConnectionId) {
      connection = availableConnections.find((c) => c.id === preferredConnectionId);
      if (connection) {
        log.info("AUTH", `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`);
      }
    }
    if (connection) {
    } else if (strategy === "round-robin") {
      const stickyLimit = providerOverride.stickyRoundRobinLimit || settings.stickyRoundRobinLimit || 3;
      connection = pickRoundRobinConnection(providerId, availableConnections, stickyLimit);
    } else {
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
      testStatus: connection.testStatus,
      lastError: connection.lastError,
      _connection: connection
    };
}

export async function markAccountUnavailable(connectionId, status, errorText, provider = null, model = null, resetsAtMs = null) {
  if (!connectionId || connectionId === "noauth") return { shouldFallback: false, cooldownMs: 0 };
  const conn = await getProviderConnectionById(connectionId, { clone: false });

  const githubResetAtMs = githubMonthlyResetMs(status, errorText, provider);
  const reason = typeof errorText === "string" ? errorText.slice(0, 200) : "Provider error";

  let decision = { shouldFallback: false, cooldownMs: 0 };
  let lockUpdate = null;
  const stored = await mutateProviderConnection(connectionId, (existing) => {
    const backoffLevel = existing.backoffLevel || 0;
    let shouldFallback, cooldownMs, newBackoffLevel;
    if (githubResetAtMs) {
      shouldFallback = true;
      cooldownMs = githubResetAtMs - Date.now();
      newBackoffLevel = 0;
    } else if (resetsAtMs && resetsAtMs > Date.now()) {
      shouldFallback = true;
      cooldownMs = resolveProviderId(provider) === "antigravity"
        ? resetsAtMs - Date.now()
        : Math.min(resetsAtMs - Date.now(), MAX_RATE_LIMIT_COOLDOWN_MS);
      newBackoffLevel = 0;
    } else {
      const result = checkFallbackError(status, errorText, backoffLevel, provider);
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

export async function clearAccountError(connectionId, currentConnection, model = null) {
  if (!connectionId || connectionId === "noauth") return;
  const conn = currentConnection._connection || currentConnection;
  const now = Date.now();
  const allLockKeys = Object.keys(conn).filter(k => k.startsWith("modelLock_") && conn[k]);

  if (!conn.testStatus && !conn.lastError && allLockKeys.length === 0) return;

  const keysToClear = allLockKeys.filter(k => {
    if (model && k === `modelLock_${model}`) return true;
    if (model && k === "modelLock___all") return true;
    return new Date(conn[k]).getTime() <= now;
  });

  if (keysToClear.length === 0 && conn.testStatus !== "unavailable" && !conn.lastError) return;

  const remainingActiveLocks = allLockKeys.filter(k => {
    if (keysToClear.includes(k)) return false;
    return new Date(conn[k]).getTime() > now;
  });

  const clearObj = Object.fromEntries(keysToClear.map(k => [k, null]));

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

export function extractApiKey(request) {
  return extractClientApiKey(request);
}

export async function isValidApiKey(apiKey) {
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}
