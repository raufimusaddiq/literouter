
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { ANTHROPIC_API_VERSION } from "../../providers/shared.js";
import { U, parseResetTime } from "./shared.js";

const CLAUDE_CONFIG = {
  oauthUsageUrl: U("claude").oauthUrl,
  usageUrl: U("claude").orgUrl,
  settingsUrl: U("claude").settingsUrl,
  apiVersion: ANTHROPIC_API_VERSION,
};

const OAUTH_429_COOLDOWN_MS = 180000;
const oauthCooldown = new Map();

const USAGE_CACHE_TTL_MS = 300000;
const USAGE_CACHE_MAX = 200;
const usageCache = new Map();

function evictUsageCache() {
  if (usageCache.size < USAGE_CACHE_MAX) return;
  const now = Date.now();
  for (const [k, v] of usageCache) {
    if (!v.promise && v.expiresAt <= now) usageCache.delete(k);
  }
  while (usageCache.size >= USAGE_CACHE_MAX) {
    let oldestKey = null;
    let oldest = Infinity;
    for (const [k, v] of usageCache) {
      if (v.promise) continue;
      if (v.expiresAt < oldest) { oldest = v.expiresAt; oldestKey = k; }
    }
    if (oldestKey === null) break;
    usageCache.delete(oldestKey);
  }
}

export function __resetClaudeUsageCacheForTests() {
  usageCache.clear();
}

export async function getClaudeUsage(accessToken, proxyOptions = null, options = {}) {
  const force = options?.force === true;

  if (!force && accessToken) {
    const hit = usageCache.get(accessToken);
    if (hit?.promise) return hit.promise;
    if (hit && hit.expiresAt > Date.now()) return hit.result;
  }

  const prev = accessToken ? usageCache.get(accessToken) : null;
  const stale = (!force && prev?.result) || null;

  const finish = (settled) => {
    if (usageCache.get(accessToken)?.promise !== promise) return;
    if (settled) {
      usageCache.set(accessToken, { result: settled, expiresAt: Date.now() + USAGE_CACHE_TTL_MS });
    } else if (stale) {
      usageCache.set(accessToken, { result: stale, expiresAt: 0 });
    } else {
      usageCache.delete(accessToken);
    }
  };

  const promise = (async () => {
    try {
      const result = await fetchClaudeUsageRaw(accessToken, proxyOptions);
      if (accessToken && result?.quotas) {
        finish(result);
        return result;
      }
      if (accessToken) finish(null);
      return stale || result;
    } catch (err) {
      if (accessToken) finish(null);
      throw err;
    }
  })();

  if (accessToken) {
    evictUsageCache();
    usageCache.set(accessToken, { promise });
  }
  return promise;
}

async function fetchClaudeUsageRaw(accessToken, proxyOptions = null) {
  try {
    const cooldownUntil = oauthCooldown.get(accessToken);
    if (cooldownUntil && Date.now() < cooldownUntil) {
      return await getClaudeUsageLegacy(accessToken, proxyOptions);
    }

    const oauthResponse = await proxyAwareFetch(CLAUDE_CONFIG.oauthUsageUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": CLAUDE_CONFIG.apiVersion,
      },
    }, proxyOptions);

    if (oauthResponse.ok) {
      const data = await oauthResponse.json();
      const quotas = {};

      const hasUtilization = (window) =>
        window && typeof window === "object" && typeof window.utilization === "number";

      const createQuotaObject = (window) => {
        const used = window.utilization;
        const remaining = Math.max(0, 100 - used);
        return {
          used,
          total: 100,
          remaining,
          remainingPercentage: remaining,
          resetAt: parseResetTime(window.resets_at),
          unlimited: false,
        };
      };

      if (hasUtilization(data.five_hour)) {
        quotas["session (5h)"] = createQuotaObject(data.five_hour);
      }

      if (hasUtilization(data.seven_day)) {
        quotas["weekly (7d)"] = createQuotaObject(data.seven_day);
      }

      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith("seven_day_") && key !== "seven_day" && hasUtilization(value)) {
          const modelName = key.replace("seven_day_", "");
          quotas[`weekly ${modelName} (7d)`] = createQuotaObject(value);
        }
      }

      if (Array.isArray(data.limits)) {
        for (const limit of data.limits) {
          if (limit?.kind !== "weekly_scoped") continue;
          const modelName = String(limit?.scope?.model?.display_name || "").trim().toLowerCase();
          if (!modelName || typeof limit.percent !== "number") continue;
          quotas[`weekly ${modelName} (7d)`] = createQuotaObject({
            utilization: Math.max(0, Math.min(100, limit.percent)),
            resets_at: limit.resets_at,
          });
        }
      }

      return {
        plan: "Claude Code",
        extraUsage: data.extra_usage ?? null,
        quotas,
      };
    }

    if (oauthResponse.status === 429) {
      oauthCooldown.set(accessToken, Date.now() + OAUTH_429_COOLDOWN_MS);
    }

    console.warn(`[Claude Usage] OAuth endpoint returned ${oauthResponse.status}, falling back to legacy`);
    return await getClaudeUsageLegacy(accessToken, proxyOptions);
  } catch (error) {
    return { message: `Claude connected. Unable to fetch usage: ${error.message}` };
  }
}

async function getClaudeUsageLegacy(accessToken, proxyOptions = null) {
  try {
    const settingsResponse = await proxyAwareFetch(CLAUDE_CONFIG.settingsUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "anthropic-version": CLAUDE_CONFIG.apiVersion,
      },
    }, proxyOptions);

    if (settingsResponse.ok) {
      const settings = await settingsResponse.json();

      if (settings.organization_id) {
        const usageResponse = await proxyAwareFetch(
          CLAUDE_CONFIG.usageUrl.replace("{org_id}", settings.organization_id),
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "anthropic-version": CLAUDE_CONFIG.apiVersion,
            },
          },
          proxyOptions
        );

        if (usageResponse.ok) {
          const usage = await usageResponse.json();
          return {
            plan: settings.plan || "Unknown",
            organization: settings.organization_name,
            quotas: usage,
          };
        }
      }

      return {
        plan: settings.plan || "Unknown",
        organization: settings.organization_name,
        message: "Claude connected. Usage details require admin access.",
      };
    }

    return { message: "Claude connected. Usage API requires admin permissions." };
  } catch (error) {
    return { message: `Claude connected. Unable to fetch usage: ${error.message}` };
  }
}
