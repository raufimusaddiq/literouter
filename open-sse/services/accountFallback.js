import { SCOPE, ERROR_RULES, BACKOFF_CONFIG, TRANSIENT_COOLDOWN_MS } from "../config/errorConfig.js";

export function getQuotaCooldown(backoffLevel = 0) {
  const level = Math.max(0, backoffLevel - 1);
  const cooldown = BACKOFF_CONFIG.base * Math.pow(2, level);
  return Math.min(cooldown, BACKOFF_CONFIG.max);
}

export function checkFallbackError(status, errorText, backoffLevel = 0, provider = null) {
  const lowerError = errorText
    ? (typeof errorText === "string" ? errorText : JSON.stringify(errorText)).toLowerCase()
    : "";

  for (const rule of ERROR_RULES) {
    if (rule.provider && rule.provider !== provider) continue;
    if (rule.text && lowerError && lowerError.includes(rule.text)) {
      return ruleResult(rule, backoffLevel);
    }

    if (rule.status && rule.status === status) {
      return ruleResult(rule, backoffLevel);
    }
  }

  if (status >= 400 && status < 500 && status !== 401 && status !== 402 && status !== 403 && status !== 429) {
    return { shouldFallback: false, cooldownMs: 0, scope: SCOPE.request };
  }

  return { shouldFallback: true, cooldownMs: TRANSIENT_COOLDOWN_MS, scope: SCOPE.account };
}

function ruleResult(rule, backoffLevel) {
  const scope = rule.scope || SCOPE.account;
  if (rule.backoff) {
    const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
    return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), scope, newBackoffLevel: newLevel };
  }
  return { shouldFallback: scope !== SCOPE.request, cooldownMs: rule.cooldownMs, scope };
}

export function shouldRotateAccount(result) {
  return !!result?.shouldFallback && (result.scope || SCOPE.account) === SCOPE.account;
}

export function isAccountUnavailable(unavailableUntil) {
  if (!unavailableUntil) return false;
  return new Date(unavailableUntil).getTime() > Date.now();
}

export function getUnavailableUntil(cooldownMs) {
  return new Date(Date.now() + cooldownMs).toISOString();
}

export function formatRetryAfter(rateLimitedUntil) {
  if (!rateLimitedUntil) return "";
  const diffMs = new Date(rateLimitedUntil).getTime() - Date.now();
  if (diffMs <= 0) return "reset after 0s";
  const totalSec = Math.ceil(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return `reset after ${parts.join(" ")}`;
}

export const MODEL_LOCK_PREFIX = "modelLock_";

export const MODEL_LOCK_ALL = `${MODEL_LOCK_PREFIX}__all`;

export function getModelLockKey(model) {
  return model ? `${MODEL_LOCK_PREFIX}${model}` : MODEL_LOCK_ALL;
}

export function isModelLockActive(connection, model) {
  const key = getModelLockKey(model);
  const expiry = connection[key] || connection[MODEL_LOCK_ALL];
  if (!expiry) return false;
  return new Date(expiry).getTime() > Date.now();
}

export function getEarliestModelLockUntil(connection) {
  if (!connection) return null;
  let earliest = null;
  const now = Date.now();
  for (const [key, val] of Object.entries(connection)) {
    if (!key.startsWith(MODEL_LOCK_PREFIX) || !val) continue;
    const t = new Date(val).getTime();
    if (t <= now) continue;
    if (!earliest || t < earliest) earliest = t;
  }
  return earliest ? new Date(earliest).toISOString() : null;
}

export function buildModelLockUpdate(model, cooldownMs) {
  const key = getModelLockKey(model);
  return { [key]: new Date(Date.now() + cooldownMs).toISOString() };
}

export function filterAvailableAccounts(accounts, excludeId = null) {
  const now = Date.now();
  return accounts.filter(acc => {
    if (excludeId && acc.id === excludeId) return false;
    if (acc.rateLimitedUntil) {
      const until = new Date(acc.rateLimitedUntil).getTime();
      if (until > now) return false;
    }
    return true;
  });
}
