
import { fetchWithTimeout, parseResetTime, toFiniteNumber, U } from "./shared.js";

const QUOTAS_URL = U("synthetic").url;
const PLAN = "Synthetic";

const REQUEST_BUCKETS = [
  ["Subscription", "subscription"],
  ["Search (hourly)", "search.hourly"],
];

function pick(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function countQuota(bucket) {
  if (!bucket || typeof bucket !== "object") return null;
  const total = toFiniteNumber(bucket.limit, 0);
  if (total <= 0) return null;
  const used = Math.max(0, Math.min(total, toFiniteNumber(bucket.requests, 0)));
  return {
    used,
    total,
    remainingPercentage: Math.round(((total - used) / total) * 100),
    resetAt: parseResetTime(bucket.renewsAt),
    unlimited: false,
  };
}

function weeklyQuota(weekly) {
  if (!weekly || typeof weekly !== "object") return null;
  const raw = weekly.percentRemaining;
  if (raw === undefined || raw === null || raw === "") return null;
  const remainingPercentage = Math.max(0, Math.min(100, toFiniteNumber(raw, 0)));
  return {
    used: Math.round((100 - remainingPercentage) * 100) / 100,
    total: 100,
    remainingPercentage,
    resetAt: parseResetTime(weekly.nextRegenAt),
    unlimited: false,
  };
}

export async function getSyntheticUsage(apiKey, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "Synthetic API key not available. Add a key to view usage." };
  }

  try {
    const response = await fetchWithTimeout(
      QUOTAS_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          Accept: "application/json",
        },
      },
      10000,
      proxyOptions,
    );

    if (response.status === 401 || response.status === 403) {
      return { plan: PLAN, message: "Synthetic authentication failed. Check the API key." };
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        plan: PLAN,
        message: `Synthetic quotas API error (${response.status})${errText ? `: ${errText.slice(0, 120)}` : ""}`,
      };
    }

    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return { plan: PLAN, message: "Synthetic quotas response was not JSON." };
    }

    const quotas = {};
    for (const [name, path] of REQUEST_BUCKETS) {
      const quota = countQuota(pick(data, path));
      if (quota) quotas[name] = quota;
    }
    const weekly = weeklyQuota(data.planWeeklyLimit);
    if (weekly) quotas["Weekly"] = weekly;

    if (Object.keys(quotas).length === 0) {
      return {
        plan: PLAN,
        message: "Synthetic connected. No quota data reported for this key.",
        quotas: {},
      };
    }

    return { plan: PLAN, quotas };
  } catch (error) {
    return { plan: PLAN, message: `Synthetic error: ${error.message}` };
  }
}
