
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { fetchWithTimeout, parseResetTime, toFiniteNumber } from "./shared.js";

const BALANCE_URL = "https://api.deeprelay.ai/v1/billing/balance";
const USAGE_URL = "https://api.deeprelay.ai/v1/usage?bucket=day";
const PLAN = "DeepRelay";
const USAGE_TIMEOUT_MS = 5000;
function centsToUsd(cents) {
  return Math.round(toFiniteNumber(cents, 0)) / 100;
}

function authHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey.trim()}`, Accept: "application/json" };
}

function readErrorCode(body) {
  return body?.error?.code || body?.error?.type || body?.code || null;
}

function spendQuota(usageBody) {
  const rows = Array.isArray(usageBody?.data) ? usageBody.data : [];
  if (rows.length === 0) return null;

  let totalCents = 0;
  let earliest = null;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    totalCents += toFiniteNumber(row.cost_cents, 0);
    const bucketStart = parseResetTime(row.bucket_start);
    if (bucketStart && (earliest === null || bucketStart < earliest)) earliest = bucketStart;
  }

  return {
    used: Math.round(totalCents) / 100,
    total: 0,
    remainingPercentage: 100,
    resetAt: null,
    unlimited: true,
    unit: "USD",
    windowStart: earliest,
  };
}

async function fetchUsageSpend(apiKey, proxyOptions) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), USAGE_TIMEOUT_MS);
  try {
    const response = await proxyAwareFetch(
      USAGE_URL,
      { method: "GET", headers: authHeaders(apiKey), signal: controller.signal },
      proxyOptions,
    );
    if (!response.ok) return null;
    return spendQuota(await response.json().catch(() => null));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getDeepRelayUsage(apiKey, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "DeepRelay API key not available. Add a key to view usage." };
  }

  try {
    const response = await fetchWithTimeout(
      BALANCE_URL,
      { method: "GET", headers: authHeaders(apiKey) },
      10000,
      proxyOptions,
    );

    if (response.status === 401) {
      return { plan: PLAN, message: "DeepRelay authentication failed. Check the API key." };
    }

    if (response.status === 403) {
      const body = await response.json().catch(() => null);
      return {
        plan: PLAN,
        message: readErrorCode(body) === "insufficient_scope"
          ? "DeepRelay key is missing the billing:read scope needed to read the wallet."
          : "DeepRelay access forbidden for this API key.",
      };
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        plan: PLAN,
        message: `DeepRelay balance API error (${response.status})${errText ? `: ${errText.slice(0, 120)}` : ""}`,
      };
    }

    const balance = await response.json().catch(() => null);
    if (!balance || typeof balance !== "object") {
      return { plan: PLAN, message: "DeepRelay balance response was not JSON." };
    }

    const dollars = balance.balance_dollars !== undefined
      ? toFiniteNumber(balance.balance_dollars, 0)
      : centsToUsd(balance.balance_cents);

    const quotas = {
      "Balance ($)": {
        used: 0,
        total: Math.max(0, Math.round(dollars * 100) / 100),
        remainingPercentage: dollars > 0 ? 100 : 0,
        resetAt: null,
        unlimited: false,
        unit: "USD",
      },
    };

    const burnPerHour = centsToUsd(balance.burn_cents_per_hour);
    if (burnPerHour > 0) {
      quotas["Burn rate ($/h)"] = {
        used: burnPerHour,
        total: 0,
        remainingPercentage: 100,
        resetAt: null,
        unlimited: true,
        unit: "USD",
      };
    }

    const spend = await fetchUsageSpend(apiKey.trim(), proxyOptions);
    if (spend) quotas["Spend (30d)"] = spend;

    return { plan: PLAN, quotas };
  } catch (error) {
    return { message: `DeepRelay error: ${error.message}` };
  }
}
