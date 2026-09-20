import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ponytail: process-local cache; UI writes invalidate it, external writers wait for TTL
const comboCache = global.__liteRouterComboCache ??= { rows: null, expiresAt: 0 };
const COMBO_CACHE_TTL_MS = Math.max(1000, Number(process.env.RUNTIME_CONFIG_TTL_MS || 5000));
function invalidateComboCache() { comboCache.rows = null; comboCache.expiresAt = 0; }

async function allCombosCached() {
  if (comboCache.rows && comboCache.expiresAt > Date.now()) return comboCache.rows;
  const db = await getAdapter();
  comboCache.rows = db.all(`SELECT * FROM combos ORDER BY createdAt ASC`).map(rowToCombo);
  comboCache.expiresAt = Date.now() + COMBO_CACHE_TTL_MS;
  return comboCache.rows;
}

export async function getCombos() {
  return (await allCombosCached()).map((c) => structuredClone(c));
}

export async function getComboById(id) {
  const row = (await allCombosCached()).find((combo) => combo.id === id);
  return row ? structuredClone(row) : null;
}

export async function getComboByName(name) {
  const row = (await allCombosCached()).find((combo) => combo.name === name);
  return row ? structuredClone(row) : null;
}

export async function createCombo(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.createdAt, combo.updatedAt]
  );
  invalidateComboCache();
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToCombo(row), ...data, updatedAt: new Date().toISOString() };
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.updatedAt, id]
    );
    result = merged;
  });
  invalidateComboCache();
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  invalidateComboCache();
  return (res?.changes ?? 0) > 0;
}
