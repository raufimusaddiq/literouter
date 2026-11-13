
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { parseResetTime, toFiniteNumber } from "./shared.js";

const API_BASE = "https://amr-api.open-design.ai/api/v1";
const WORKSPACES_URL = `${API_BASE}/workspaces`;
const PLAN = "OpenDesign Go";
const REQUEST_TIMEOUT_MS = 10000;
const WINDOW_NAMES = [
  [18000, "Session (5h)"],
  [604800, "Weekly (7d)"],
];

const MISSING_CONTROL_KEY_MESSAGE =
  "OpenDesign Go: control key not configured. Paste the Control Key (vela_ctrl_...) into the OpenDesign provider settings; the runtime key sk-amr cannot read quota.";

function authHeaders(controlKey, workspaceId) {
  const headers = {
    Authorization: `Bearer ${controlKey.trim()}`,
    accept: "application/json",
  };
  if (workspaceId) headers["x-vela-workspace-id"] = workspaceId;
  return headers;
}

async function getJson(url, controlKey, workspaceId, proxyOptions) {
  try {
    const response = await proxyAwareFetch(
      url,
      {
        method: "GET",
        headers: authHeaders(controlKey, workspaceId),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
      proxyOptions,
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}${errText ? `: ${errText.slice(0, 120)}` : ""}`,
      };
    }

    const body = await response.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return { ok: false, status: response.status, error: "response was not JSON" };
    }
    return { ok: true, body };
  } catch (error) {
    return { ok: false, error: error?.message || "request failed" };
  }
}

async function resolveWorkspaceId(controlKey, providerSpecificData, proxyOptions) {
  const pinned = providerSpecificData?.opendesignWorkspaceId;
  if (typeof pinned === "string" && pinned.trim()) {
    return { workspaceId: pinned.trim(), error: null };
  }

  const result = await getJson(WORKSPACES_URL, controlKey, null, proxyOptions);
  if (!result.ok) return { workspaceId: null, error: result.error };

  const items = Array.isArray(result.body?.items) ? result.body.items : [];
  const ids = items
    .map((item) => (item && typeof item === "object" && typeof item.workspaceId === "string"
      ? item.workspaceId.trim()
      : ""))
    .filter(Boolean);
  if (ids.length === 0) {
    return { workspaceId: null, error: "no workspace found for this Control Key" };
  }
  if (ids.length > 1) {
    return {
      workspaceId: null,
      error: `This Control Key sees ${ids.length} workspaces (${ids.join(", ")}). Pick the account's workspace in the provider settings (providerSpecificData.opendesignWorkspaceId) so another workspace's quota is not shown here.`,
    };
  }
  return { workspaceId: ids[0], error: null };
}

function workspaceMatches(body, workspaceId) {
  if (!body || typeof body !== "object") return false;
  if (typeof body.workspaceId !== "string") return false;
  return body.workspaceId.trim() === workspaceId;
}

function parseCredits(value) {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

function remainingPercentOf(used, limit) {
  if (limit <= 0n) return null;
  const usedClamped = used > limit ? limit : used;
  const remaining = limit - usedClamped;
  const ratio = Number((remaining * 1000000000n) / limit) / 10000000;
  return Math.max(0, Math.min(100, ratio));
}

function windowQuota(window) {
  if (!window || typeof window !== "object") return null;
  const used = parseCredits(window.usedCredits);
  const limit = parseCredits(window.limitCredits);
  if (used === null || limit === null || limit <= 0n) return null;

  const remainingPercent = remainingPercentOf(used, limit);
  if (remainingPercent === null) return null;

  return {
    used: Number(used),
    total: Number(limit),
    remainingPercentage: Math.round(remainingPercent * 100) / 100,
    resetAt: parseResetTime(window.resetsAt),
    unlimited: false,
  };
}

function planQuotas(preflight) {
  const codingPlan = preflight?.codingPlan;
  const windows = Array.isArray(codingPlan?.windows) ? codingPlan.windows : [];
  if (codingPlan?.eligible === false || windows.length === 0) return {};

  const quotas = {};
  for (const [durationSeconds, name] of WINDOW_NAMES) {
    const window = windows.find((w) => w && toFiniteNumber(w.durationSeconds, -1) === durationSeconds);
    const quota = windowQuota(window);
    if (quota) quotas[name] = quota;
  }
  return quotas;
}

function balanceQuota(body) {
  const raw = body?.balanceUsd;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const dollars = toFiniteNumber(raw.trim(), null);
  if (dollars === null || dollars < 0) return null;

  return {
    used: 0,
    total: Math.round(dollars * 100) / 100,
    remainingPercentage: 100,
    resetAt: null,
    unlimited: false,
    unit: "USD",
  };
}

function describeFailure(label, error) {
  return `${label}: ${error}`;
}

export async function getOpenDesignUsage(ctx = {}) {
  const providerSpecificData = ctx.providerSpecificData || {};
  const controlKey = providerSpecificData.opendesignControlKey;

  if (!controlKey || typeof controlKey !== "string" || !controlKey.trim()) {
    return { plan: PLAN, message: MISSING_CONTROL_KEY_MESSAGE };
  }

  try {
    const resolved = await resolveWorkspaceId(controlKey, providerSpecificData, ctx.proxyOptions);
    if (!resolved.workspaceId) {
      return {
        plan: PLAN,
        message: `Unable to resolve the OpenDesign workspace: ${resolved.error}. Check the Control Key (vela_ctrl_...) or set workspaceId manually.`,
      };
    }

    const workspaceId = resolved.workspaceId;
    const preflightUrl = `${API_BASE}/workspaces/${encodeURIComponent(workspaceId)}/billing/preflight`;
    const balanceUrl = `${API_BASE}/workspaces/${encodeURIComponent(workspaceId)}/wallet/balance`;

    const [preflight, balance] = await Promise.all([
      getJson(preflightUrl, controlKey, workspaceId, ctx.proxyOptions),
      getJson(balanceUrl, controlKey, workspaceId, ctx.proxyOptions),
    ]);

    const quotas = {};
    const errors = [];

    if (!preflight.ok) {
      errors.push(describeFailure("preflight", preflight.error));
    } else if (!workspaceMatches(preflight.body, workspaceId)) {
      errors.push("preflight: workspaceId mismatch");
    } else {
      Object.assign(quotas, planQuotas(preflight.body));
    }

    if (!balance.ok) {
      errors.push(describeFailure("wallet", balance.error));
    } else if (!workspaceMatches(balance.body, workspaceId)) {
      errors.push("wallet: workspaceId mismatch");
    } else {
      const quota = balanceQuota(balance.body);
      if (quota) quotas["Balance ($)"] = quota;
    }

    const rowCount = Object.keys(quotas).length;

    if (rowCount === 0 && errors.length >= 2) {
      return {
        plan: PLAN,
        message: `Could not read OpenDesign Go quota — ${errors.join("; ")}`,
      };
    }

    if (rowCount === 0) {
      const tail = errors.length ? ` (${errors.join("; ")})` : "";
      return {
        plan: PLAN,
        message: `OpenDesign Go is connected but this account reports no quota${tail}.`,
        quotas: {},
      };
    }

    return { plan: PLAN, quotas };
  } catch (error) {
    return { plan: PLAN, message: `OpenDesign error: ${error.message}` };
  }
}
