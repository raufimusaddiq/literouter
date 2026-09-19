import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

// PRD 15.1/15.2: API-key lookup must not hit SQLite per request. The key set is
// tiny, so cache the whole table and match in memory. TTL bounds how long a key
// revoked by another process stays usable; UI mutations invalidate directly.
// ponytail: process-local cache, Redis invalidation when multi-replica matters
const keyCache = global.__liteRouterApiKeyCache ??= { rows: null, expiresAt: 0 };
const CACHE_TTL_MS = 5000;
function invalidateApiKeyCache() { keyCache.rows = null; keyCache.expiresAt = 0; }

async function allKeys() {
  if (keyCache.rows && keyCache.expiresAt > Date.now()) return keyCache.rows;
  const db = await getAdapter();
  keyCache.rows = db.all(`SELECT key, isActive FROM apiKeys`);
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

export async function createApiKey(name, machineId) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt]
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
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, id]
    );
    result = merged;
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
  const row = (await allKeys()).find((r) => r.key === key);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}
