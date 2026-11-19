// Single source of truth for connection health, shared by Overview and Providers.
//
// Every connection lands in exactly one bucket, so ready + attention + inactive + untested === total:
//   inactive  - isActive === false (disabled by the operator). Always wins, even if the
//               last test failed: a disabled connection is not routing, so it is not
//               "needing attention" either.
//   attention - active, and one of: rate-limited (rateLimitedUntil in the future),
//               cooldown (testStatus "unavailable" with a live modelLock_* in the future),
//               expired credentials, or error. `reason` says which.
//   ready     - verified passing (active/success), or a stale "unavailable" whose
//               cooldown has ended.
//   untested  - active but never tested (no testStatus); not counted as ready.

export const HEALTH = Object.freeze({
  READY: "ready",
  ATTENTION: "attention",
  INACTIVE: "inactive",
  UNTESTED: "untested",
});

export const HEALTH_LABELS = Object.freeze({
  ready: "Ready",
  attention: "Needs attention",
  inactive: "Inactive",
  untested: "Untested",
});

export const ATTENTION_REASONS = Object.freeze({
  RATE_LIMITED: "rate_limited",
  COOLDOWN: "cooldown",
  EXPIRED: "expired",
  ERROR: "error",
});

const isFuture = (value, now) => {
  if (!value) return false;
  const t = new Date(value).getTime();
  return Number.isFinite(t) && t > now;
};

export function hasActiveCooldown(connection, now = Date.now()) {
  return Object.entries(connection || {}).some(
    ([key, value]) => key.startsWith("modelLock_") && isFuture(value, now),
  );
}

export function classifyConnection(connection, now = Date.now()) {
  const c = connection || {};
  if (c.isActive === false) return { status: HEALTH.INACTIVE, reason: "disabled" };
  if (isFuture(c.rateLimitedUntil, now)) {
    return { status: HEALTH.ATTENTION, reason: ATTENTION_REASONS.RATE_LIMITED };
  }
  if (c.testStatus === "unavailable") {
    return hasActiveCooldown(c, now)
      ? { status: HEALTH.ATTENTION, reason: ATTENTION_REASONS.COOLDOWN }
      : { status: HEALTH.READY, reason: "cooldown_ended" };
  }
  if (c.testStatus === "expired") return { status: HEALTH.ATTENTION, reason: ATTENTION_REASONS.EXPIRED };
  if (c.testStatus === "error") return { status: HEALTH.ATTENTION, reason: ATTENTION_REASONS.ERROR };
  if (c.testStatus === "active" || c.testStatus === "success") {
    return { status: HEALTH.READY, reason: "passing" };
  }
  return { status: HEALTH.UNTESTED, reason: "untested" };
}

export function getConnectionHealthStats(connections, now = Date.now()) {
  const list = Array.isArray(connections) ? connections : [];
  const stats = { total: list.length, ready: 0, attention: 0, inactive: 0, untested: 0, attentionItems: [] };
  for (const connection of list) {
    const { status, reason } = classifyConnection(connection, now);
    stats[status] += 1;
    if (status === HEALTH.ATTENTION) stats.attentionItems.push({ connection, reason });
  }
  return stats;
}
