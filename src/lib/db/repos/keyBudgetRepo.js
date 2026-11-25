import { getAdapter } from "../driver.js";

const pending = globalThis.__liteRouterBudgetPending ??= new Map();

const pad = (n) => String(n).padStart(2, "0");

export function budgetWindow(period, ts = Date.now()) {
  const d = new Date(ts);
  const month = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  return period === "month" ? month : `${month}-${pad(d.getUTCDate())}`;
}

export function budgetResetsAt(period, ts = Date.now()) {
  const d = new Date(ts);
  const start = period === "month"
    ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
    : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return new Date(start).toISOString();
}

function pendingSlot(keyId, window) {
  const key = `${keyId}\u0000${window}`;
  let slot = pending.get(key);
  if (!slot) {
    slot = { keyId, window, tokens: 0, cost: 0 };
    pending.set(key, slot);
  }
  return slot;
}

export function noteBudgetSpend({ keyId, period, tokens, cost, ts = Date.now() }) {
  const slot = pendingSlot(keyId, budgetWindow(period, ts));
  slot.tokens += tokens || 0;
  slot.cost += cost || 0;
}

export function settleBudgetSpend(entries) {
  for (const entry of entries) {
    if (!entry.budgetKeyId) continue;
    const window = budgetWindow(entry.budgetPeriod, Date.parse(entry.timestamp));
    const key = `${entry.budgetKeyId}\u0000${window}`;
    const slot = pending.get(key);
    if (!slot) continue;
    slot.tokens = Math.max(0, slot.tokens - (entry.budgetTokens || 0));
    slot.cost = Math.max(0, slot.cost - (entry.budgetCost || 0));
    if (slot.tokens === 0 && slot.cost === 0) pending.delete(key);
  }
}

export function addBudgetSpend(db, entry) {
  if (!entry.budgetKeyId) return;
  db.run(
    `INSERT INTO apiKeyBudgetSpend(keyId, window, tokens, cost) VALUES(?, ?, ?, ?)
     ON CONFLICT(keyId, window) DO UPDATE SET tokens = tokens + excluded.tokens, cost = cost + excluded.cost`,
    [
      entry.budgetKeyId,
      budgetWindow(entry.budgetPeriod, Date.parse(entry.timestamp)),
      entry.budgetTokens || 0,
      entry.budgetCost || 0,
    ]
  );
}

export async function getBudgetSpend(keyId, period, now = Date.now()) {
  const db = await getAdapter();
  const window = budgetWindow(period, now);
  const row = db.get(`SELECT tokens, cost FROM apiKeyBudgetSpend WHERE keyId = ? AND window = ?`, [keyId, window]);
  const slot = pending.get(`${keyId}\u0000${window}`);
  return {
    tokens: (row?.tokens || 0) + (slot?.tokens || 0),
    cost: (row?.cost || 0) + (slot?.cost || 0),
    resetsAt: budgetResetsAt(period, now),
  };
}

export function _resetBudgetPending() {
  pending.clear();
}
