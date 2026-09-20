import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToPool(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    isActive: row.isActive === 1 || row.isActive === true,
    testStatus: row.testStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function poolToRow(p) {
  const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
  return {
    id,
    isActive: isActive === false ? 0 : 1,
    testStatus: testStatus ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

const poolCache = global.__liteRouterProxyPoolCache ??= { rows: null, expiresAt: 0 };
const POOL_CACHE_TTL_MS = Math.max(1000, Number(process.env.RUNTIME_CONFIG_TTL_MS || 5000));

function invalidatePoolCache() {
  poolCache.rows = null;
  poolCache.expiresAt = 0;
}

async function allPoolsCached() {
  if (poolCache.rows && poolCache.expiresAt > Date.now()) return poolCache.rows;
  const db = await getAdapter();
  poolCache.rows = db.all(`SELECT * FROM proxyPools`).map(rowToPool);
  poolCache.rows.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  poolCache.expiresAt = Date.now() + POOL_CACHE_TTL_MS;
  return poolCache.rows;
}

function upsert(db, p) {
  const r = poolToRow(p);
  db.run(
    `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       isActive=excluded.isActive, testStatus=excluded.testStatus,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.isActive, r.testStatus, r.data, r.createdAt, r.updatedAt]
  );
}

export async function getProxyPools(filter = {}) {
  const rows = await allPoolsCached();
  return rows
    .filter((pool) => filter.isActive === undefined || pool.isActive === Boolean(filter.isActive))
    .filter((pool) => !filter.testStatus || pool.testStatus === filter.testStatus)
    .map((pool) => structuredClone(pool));
}

export async function getProxyPoolById(id) {
  const row = (await allPoolsCached()).find((pool) => pool.id === id);
  return row ? structuredClone(row) : null;
}

export async function createProxyPool(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const pool = {
    id: data.id || uuidv4(),
    name: data.name,
    proxyUrl: data.proxyUrl,
    noProxy: data.noProxy || "",
    type: data.type || "http",
    isActive: data.isActive !== undefined ? data.isActive : true,
    strictProxy: data.strictProxy === true,
    testStatus: data.testStatus || "unknown",
    lastTestedAt: data.lastTestedAt || null,
    lastError: data.lastError || null,
    createdAt: now,
    updatedAt: now,
  };
  upsert(db, pool);
  invalidatePoolCache();
  return pool;
}

export async function updateProxyPool(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToPool(row), ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    result = merged;
  });
  if (result) invalidatePoolCache();
  return result;
}

export async function deleteProxyPool(id) {
  const db = await getAdapter();
  let removed = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToPool(row);
    db.run(`DELETE FROM proxyPools WHERE id = ?`, [id]);
  });
  if (removed) invalidatePoolCache();
  return removed;
}
