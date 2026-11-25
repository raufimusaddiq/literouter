import { getAdapter } from "../driver.js";
import { BUDGET_PERIODS } from "@/shared/utils/keyBudget.js";

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

const slotKey = (keyId, window) => `${keyId}\u0000${window}`;

function pendingSlot(keyId, window) {
  let slot = pending.get(slotKey(keyId, window));
  if (!slot) {
    slot = { tokens: 0, cost: 0 };
    pending.set(slotKey(keyId, window), slot);
  }
  return slot;
}

export function noteBudgetSpend({ keyId, tokens, cost, ts = Date.now() }) {
  for (const period of BUDGET_PERIODS) {
    const slot = pendingSlot(keyId, budgetWindow(period, ts));
    slot.tokens += tokens || 0;
    slot.cost += cost || 0;
  }
}

export function settleBudgetSpend(entries) {
  for (const entry of entries) {
    if (!entry.budgetKeyId) continue;
    const ts = Date.parse(entry.timestamp);
    for (const period of BUDGET_PERIODS) {
      const key = slotKey(entry.budgetKeyId, budgetWindow(period, ts));
      const slot = pending.get(key);
      if (!slot) continue;
      slot.tokens = Math.max(0, slot.tokens - (entry.budgetTokens || 0));
      slot.cost = Math.max(0, slot.cost - (entry.budgetCost || 0));
      if (slot.tokens === 0 && slot.cost === 0) pending.delete(key);
    }
  }
}

export function addBudgetSpend(db, entry) {
  if (!entry.budgetKeyId) return;
  const ts = Date.parse(entry.timestamp);
  for (const period of BUDGET_PERIODS) {
    db.run(
      `INSERT INTO apiKeyBudgetSpend(keyId, window, tokens, cost) VALUES(?, ?, ?, ?)
       ON CONFLICT(keyId, window) DO UPDATE SET tokens = tokens + excluded.tokens, cost = cost + excluded.cost`,
      [entry.budgetKeyId, budgetWindow(period, ts), entry.budgetTokens || 0, entry.budgetCost || 0]
    );
  }
}

export function pruneBudgetSpend(db, now = Date.now()) {
  const d = new Date(now);
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const month = `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}`;
  db.run(`DELETE FROM apiKeyBudgetSpend WHERE length(window) = 7 AND window < ?`, [month]);
  db.run(`DELETE FROM apiKeyBudgetSpend WHERE length(window) > 7 AND window < ?`, [`${month}-01`]);
}

export async function getBudgetSpend(keyId, period, now = Date.now()) {
  const db = await getAdapter();
  const window = budgetWindow(period, now);
  const row = db.get(`SELECT tokens, cost FROM apiKeyBudgetSpend WHERE keyId = ? AND window = ?`, [keyId, window]);
  const slot = pending.get(slotKey(keyId, window));
  return {
    tokens: (row?.tokens || 0) + (slot?.tokens || 0),
    cost: (row?.cost || 0) + (slot?.cost || 0),
    resetsAt: budgetResetsAt(period, now),
  };
}

export function _resetBudgetPending() {
  pending.clear();
}
