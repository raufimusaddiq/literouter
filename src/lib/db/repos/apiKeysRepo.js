import { bumpConfigVersion } from "../configVersion.js";
import { safeEqual } from "@/shared/utils/safeEqual.js";
import { getAdapter } from "../driver.js";
import { keyAccessFromColumns, keyAccessToColumns } from "@/shared/utils/keyAccess.js";
import { budgetFromColumns, budgetToColumns } from "@/shared/utils/keyBudget.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";

const keyCache = global.__liteRouterApiKeyCache ??= { rows: null, expiresAt: 0 };
const CACHE_TTL_MS = 5000;
function invalidateApiKeyCache() { keyCache.rows = null; keyCache.expiresAt = 0; bumpConfigVersion(); }

function findRowByKey(rows, key) {
  let found = null;
  for (const row of rows) {
    if (safeEqual(row.key, key) && !found) found = row;
  }
  return found;
}

async function allKeys() {
  if (keyCache.rows && keyCache.expiresAt > Date.now()) return keyCache.rows;
  const db = await getAdapter();
  keyCache.rows = db.all(`SELECT id, key, name, isActive, accessRestricted, accessAllow, budgetPeriod, budgetMaxTokens, budgetMaxCost FROM apiKeys`);
  keyCache.expiresAt = Date.now() + CACHE_TTL_MS;
  return keyCache.rows;
}

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    access: keyAccessFromColumns(row.accessRestricted, row.accessAllow),
    budget: budgetFromColumns(row.budgetPeriod, row.budgetMaxTokens, row.budgetMaxCost),
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function getApiKeyByKey(key) {
  if (!key) return null;
  return rowToKey(findRowByKey(await allKeys(), key));
}

export async function createApiKey(name, machineId) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: crypto.randomUUID(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    access: { restricted: false, allow: [] },
  };
  const cols = keyAccessToColumns(KEY_ACCESS_UNRESTRICTED);
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt, cols.accessRestricted, cols.accessAllow]
  );
  invalidateApiKeyCache();
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    const cols = keyAccessToColumns(merged.access);
    const budget = budgetToColumns(merged.budget);
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, accessRestricted = ?, accessAllow = ?, budgetPeriod = ?, budgetMaxTokens = ?, budgetMaxCost = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, cols.accessRestricted, cols.accessAllow, budget.budgetPeriod, budget.budgetMaxTokens, budget.budgetMaxCost, id]
    );
    result = rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
  });
  invalidateApiKeyCache();
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  invalidateApiKeyCache();
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  if (!key) return false;
  const row = findRowByKey(await allKeys(), key);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}
