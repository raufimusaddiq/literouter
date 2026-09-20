import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "./jsonCol.js";

const kvCache = global.__liteRouterKvCache ??= new Map();
const KV_CACHE_TTL_MS = Math.max(1000, Number(process.env.RUNTIME_CONFIG_TTL_MS || 5000));

function invalidateScope(scope) {
  kvCache.delete(scope);
}

async function getScope(scope) {
  const cached = kvCache.get(scope);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const db = await getAdapter();
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [scope]);
  const out = {};
  for (const row of rows) out[row.key] = parseJson(row.value);
  kvCache.set(scope, { value: out, expiresAt: Date.now() + KV_CACHE_TTL_MS });
  return out;
}

export function makeKv(scope) {
  return {
    async get(key, fallback = null) {
      const all = await getScope(scope);
      return Object.hasOwn(all, key) ? structuredClone(all[key]) : fallback;
    },
    async getAll() {
      return structuredClone(await getScope(scope));
    },
    async set(key, value) {
      const db = await getAdapter();
      db.run(`INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`, [scope, key, stringifyJson(value)]);
      invalidateScope(scope);
    },
    async setMany(obj) {
      const db = await getAdapter();
      db.transaction(() => {
        for (const [k, v] of Object.entries(obj)) {
          db.run(`INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`, [scope, k, stringifyJson(v)]);
        }
      });
      invalidateScope(scope);
    },
    async remove(key) {
      const db = await getAdapter();
      db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [scope, key]);
      invalidateScope(scope);
    },
    async clear() {
      const db = await getAdapter();
      db.run(`DELETE FROM kv WHERE scope = ?`, [scope]);
      invalidateScope(scope);
    },
  };
}

export function invalidateKvScope(scope) {
  invalidateScope(scope);
}
