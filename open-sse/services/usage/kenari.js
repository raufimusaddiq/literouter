/**
 * Kenari usage — GET https://kenari.id/v1/account/quota
 * Auth: Bearer <apiKey>. Returns plan + month/week IDR windows.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { toFiniteNumber } from "./shared.js";

export async function getKenariUsage(apiKey = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "Kenari API key not available. Add a key to view usage." };
  }

  try {
    const response = await proxyAwareFetch(
      "https://kenari.id/v1/account/quota",
      {
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );

    if (response.status === 401 || response.status === 403) {
      return { message: "Kenari authentication failed. Check the API key." };
    }
    if (!response.ok) {
      return { message: `Kenari quota API error (${response.status}).` };
    }

    const data = await response.json().catch(() => null);
    if (!data?.plan) return { message: "Kenari connected. No plan data returned." };

    const quotas = {};
    const windows = data.plan?.windows || {};
    for (const [name, win] of Object.entries(windows)) {
      const total = toFiniteNumber(win.used_rp) + toFiniteNumber(win.remaining_rp);
      const used = toFiniteNumber(win.used_rp);
      quotas[name === "month" ? "Monthly (IDR)" : name === "week" ? "Weekly (IDR)" : name] = {
        used,
        total,
        remainingPercentage: total > 0 ? Math.round(((total - used) / total) * 100) : 0,
        resetAt: win.resets_at || null,
      };
    }

    return {
      plan: typeof data.plan?.name === "string" ? data.plan.name : "Kenari",
      quotas,
    };
  } catch (error) {
    return { message: `Kenari error: ${error.message}` };
  }
}
