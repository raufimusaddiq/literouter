import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToNode(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    type: row.type,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function nodeToRow(n) {
  const { id, type, name, createdAt, updatedAt, ...rest } = n;
  return {
    id,
    type: type ?? null,
    name: name ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

const nodeCache = global.__liteRouterProviderNodeCache ??= { rows: null, expiresAt: 0 };
const NODE_CACHE_TTL_MS = Math.max(1000, Number(process.env.RUNTIME_CONFIG_TTL_MS || 5000));

function invalidateNodeCache() {
  nodeCache.rows = null;
  nodeCache.expiresAt = 0;
}

async function allNodesCached() {
  if (nodeCache.rows && nodeCache.expiresAt > Date.now()) return nodeCache.rows;
  const db = await getAdapter();
  nodeCache.rows = db.all(`SELECT * FROM providerNodes`).map(rowToNode);
  nodeCache.expiresAt = Date.now() + NODE_CACHE_TTL_MS;
  return nodeCache.rows;
}

function upsert(db, n) {
  const r = nodeToRow(n);
  db.run(
    `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type=excluded.type, name=excluded.name, data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.type, r.name, r.data, r.createdAt, r.updatedAt]
  );
}

export async function getProviderNodes(filter = {}) {
  const rows = await allNodesCached();
  return rows
    .filter((node) => !filter.type || node.type === filter.type)
    .map((node) => structuredClone(node));
}

export async function getProviderNodeById(id) {
  const row = (await allNodesCached()).find((node) => node.id === id);
  return row ? structuredClone(row) : null;
}

export async function createProviderNode(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const node = {
    id: data.id || uuidv4(),
    type: data.type,
    name: data.name,
    prefix: data.prefix,
    apiType: data.apiType,
    transports: Array.isArray(data.transports) && data.transports.length ? data.transports : undefined,
    baseUrl: data.baseUrl,
    createdAt: now,
    updatedAt: now,
  };
  upsert(db, node);
  invalidateNodeCache();
  return node;
}

export async function updateProviderNode(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToNode(row), ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    result = merged;
  });
  if (result) invalidateNodeCache();
  return result;
}

export async function deleteProviderNode(id) {
  const db = await getAdapter();
  let removed = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToNode(row);
    db.run(`DELETE FROM providerNodes WHERE id = ?`, [id]);
  });
  if (removed) invalidateNodeCache();
  return removed;
}
