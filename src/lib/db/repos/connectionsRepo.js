import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const OPTIONAL_FIELDS = [
  "displayName", "email", "globalPriority", "defaultModel",
  "accessToken", "refreshToken", "expiresAt", "tokenType",
  "scope", "projectId", "apiKey", "testStatus",
  "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn", "errorCode",
  "consecutiveUseCount", "idToken", "lastRefreshAt",
];

const MODEL_LOCK_PREFIX = "modelLock_";

const connectionCache = global.__liteRouterConnectionCache ??= {
  rows: null,
  expiresAt: 0,
  versionCheckedAt: 0,
};
const CACHE_TTL_MS = Math.max(1000, Number(process.env.RUNTIME_CONFIG_TTL_MS || 5000));
const VERSION_TTL_MS = Math.max(500, Number(process.env.RUNTIME_CONFIG_VERSION_TTL_MS || 5000));
const MULTI_REPLICA = process.env.LITEROUTER_MULTI_REPLICA === "true";
const CACHE_VERSION_KEY = "cache:connections:version";

async function cacheVersion() {
  const { redisGet } = await import("@/lib/redis.js");
  return (await redisGet(CACHE_VERSION_KEY)) || null;
}

async function bumpCacheVersion() {
  const { redisIncrement } = await import("@/lib/redis.js");
  return redisIncrement(CACHE_VERSION_KEY);
}

function invalidateConnectionCache() {
  connectionCache.gen = (connectionCache.gen || 0) + 1;
  connectionCache.index = null;
  connectionCache.rows = null;
  connectionCache.expiresAt = 0;
  connectionCache.versionCheckedAt = 0;
}

function patchCachedConnection(conn) {
  const rows = connectionCache.rows;
  if (!rows) return;
  const i = rows.findIndex((c) => c.id === conn.id);
  if (i !== -1) {
    rows[i] = conn;
    connectionCache.index = null;
  }
}

function optimisticPatchCachedConnection(id, data) {
  const rows = connectionCache.rows;
  if (!rows) return;
  const i = rows.findIndex((c) => c.id === id);
  if (i === -1) return;
  const existing = rows[i];
  rows[i] = pruneClearedLocks({ ...existing, ...resetHealthStateOnActivation(existing, data), updatedAt: new Date().toISOString() });
  connectionCache.index = null;
}

async function invalidateConnectionCacheEverywhere({ localDone = false } = {}) {
  if (!localDone) invalidateConnectionCache();
  if (!MULTI_REPLICA) return;
  try {
    await bumpCacheVersion();
  } catch {
  }
}

function pruneClearedLocks(conn) {
  for (const key of Object.keys(conn)) {
    if (key.startsWith(MODEL_LOCK_PREFIX) && (conn[key] === null || conn[key] === undefined)) delete conn[key];
  }
  return conn;
}

function resetHealthStateOnActivation(existing, patch) {
  if (patch?.testStatus !== "active") return patch;

  const normalized = {
    ...patch,
    testStatus: "active",
    lastError: Object.hasOwn(patch, "lastError") ? patch.lastError : null,
    lastErrorAt: Object.hasOwn(patch, "lastErrorAt") ? patch.lastErrorAt : null,
    errorCode: null,
    rateLimitedUntil: null,
    backoffLevel: 0,
  };

  for (const key of Object.keys(existing || {})) {
    if (key.startsWith(MODEL_LOCK_PREFIX)) normalized[key] = null;
  }

  return normalized;
}

function rowToConn(row) {
  if (!row) return null;
  const extra = pruneClearedLocks(parseJson(row.data, {}));
  return {
    ...extra,
    id: row.id,
    provider: row.provider,
    authType: row.authType,
    name: row.name,
    email: row.email,
    priority: row.priority,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function connToRow(c) {
  const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
  return {
    id,
    provider,
    authType,
    name: name ?? null,
    email: email ?? null,
    priority: priority ?? null,
    isActive: isActive === false ? 0 : 1,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

function upsert(db, c) {
  const r = connToRow(c);
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider=excluded.provider, authType=excluded.authType, name=excluded.name,
       email=excluded.email, priority=excluded.priority, isActive=excluded.isActive,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.provider, r.authType, r.name, r.email, r.priority, r.isActive, r.data, r.createdAt, r.updatedAt]
  );
}

function deriveConnectionName(data, fallbackName) {
  if (data.provider === "github") {
    return data.providerSpecificData?.githubLogin
      || data.providerSpecificData?.githubEmail
      || data.email
      || data.providerSpecificData?.githubName
      || fallbackName;
  }
  return fallbackName;
}

export async function getProviderConnections(filter = {}, options = {}) {
  const now = Date.now();
  if (!connectionCache.rows || connectionCache.expiresAt <= now) {
    await ensureConnectionCache();
  } else if (MULTI_REPLICA && connectionCache.versionCheckedAt <= now) {
    const version = await cacheVersion();
    connectionCache.versionCheckedAt = Date.now() + VERSION_TTL_MS;
    if (version !== null && version !== connectionCache.version) {
      await ensureConnectionCache();
    }
  }
  const index = getConnectionIndex();
  const source = filter.provider ? (index.byProvider.get(filter.provider) || []) : index.all;
  const list = filter.isActive === undefined
    ? source.slice()
    : source.filter((c) => c.isActive === Boolean(filter.isActive));
  return options.clone === false ? list : list.map((c) => structuredClone(c));
}

const byPriority = (a, b) => (a.priority || 999) - (b.priority || 999);

function getConnectionIndex() {
  const rows = connectionCache.rows;
  const cached = connectionCache.index;
  if (cached && cached.rows === rows) return cached;
  const byId = new Map();
  const byProvider = new Map();
  for (const c of rows) {
    byId.set(c.id, c);
    let arr = byProvider.get(c.provider);
    if (!arr) byProvider.set(c.provider, arr = []);
    arr.push(c);
  }
  for (const arr of byProvider.values()) arr.sort(byPriority);
  const all = rows.slice().sort(byPriority);
  return (connectionCache.index = { rows, byId, byProvider, all });
}

let refreshInFlight = null;
function refreshConnectionCache() {
  const gen = connectionCache.gen || 0;
  if (!refreshInFlight || refreshInFlight.gen !== gen) {
    const entry = { gen, promise: null };
    entry.promise = doRefreshConnectionCache(gen).finally(() => {
      if (refreshInFlight === entry) refreshInFlight = null;
    });
    refreshInFlight = entry;
  }
  return refreshInFlight.promise;
}

async function ensureConnectionCache() {
  for (let attempt = 0; attempt < 3; attempt++) {
    await refreshConnectionCache();
    if (connectionCache.rows) return;
  }
  throw new Error("connection cache reload kept being invalidated");
}

async function doRefreshConnectionCache(gen) {
  const db = await getAdapter();
  if ((connectionCache.gen || 0) !== gen) return;
  connectionCache.index = null;
  connectionCache.rows = db.all("SELECT * FROM providerConnections").map(rowToConn);
  connectionCache.version = MULTI_REPLICA ? await cacheVersion() : null;
  connectionCache.expiresAt = Date.now() + CACHE_TTL_MS;
  connectionCache.versionCheckedAt = Date.now() + VERSION_TTL_MS;
}

export async function getProviderConnectionById(id, options = {}) {
  if (!connectionCache.rows || connectionCache.expiresAt <= Date.now()) {
    await ensureConnectionCache();
  }
  const row = getConnectionIndex().byId.get(id);
  if (!row) return null;
  return options.clone === false ? row : structuredClone(row);
}

function reorderInTx(db, providerId) {
  const list = db.all(`SELECT * FROM providerConnections WHERE provider = ?`, [providerId]).map(rowToConn);
  list.sort((a, b) => {
    const pDiff = (a.priority || 0) - (b.priority || 0);
    if (pDiff !== 0) return pDiff;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
  list.forEach((c, i) => {
    const want = i + 1;
    if ((c.priority || 0) !== want) {
      db.run(`UPDATE providerConnections SET priority = ? WHERE id = ?`, [want, c.id]);
    }
  });
}

export async function createProviderConnection(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  let result;

  db.transaction(() => {
    const isApikey = data.authType === "apikey" && !!data.name;
    const all = isApikey
      ? db.all(
          `SELECT * FROM providerConnections WHERE provider = ? AND authType = ? AND name = ?`,
          [data.provider, "apikey", data.name]
        ).map(rowToConn)
      : db.all(`SELECT * FROM providerConnections WHERE provider = ?`, [data.provider]).map(rowToConn);
    const poolSize = isApikey
      ? db.get(`SELECT COUNT(*) AS n FROM providerConnections WHERE provider = ?`, [data.provider])?.n ?? all.length
      : all.length;

    let existing = null;
    if (data.authType === "oauth" && data.email) {
      const incomingUsername = data.providerSpecificData?.username;
      const incomingWs = data.providerSpecificData?.chatgptAccountId;
      existing = all.find(c => {
        if (c.authType !== "oauth" || c.email !== data.email) return false;

        if (data.provider === "codex") {
          const existingWs = c.providerSpecificData?.chatgptAccountId;
          return !!incomingWs && !!existingWs && incomingWs === existingWs;
        }

        const existingWs = c.providerSpecificData?.chatgptAccountId;
        if (incomingWs && existingWs) return incomingWs === existingWs;
        if (incomingWs && !existingWs) return false;
        if (!incomingWs && existingWs) return false;
        const existingUsername = c.providerSpecificData?.username;
        if (incomingUsername && existingUsername) {
          return incomingUsername === existingUsername;
        }
        if (incomingUsername || existingUsername) return false;
        return true;
      });
    } else if (data.authType === "apikey" && data.name) {
      existing = all.find(c => c.authType === "apikey" && c.name === data.name);
    }

    if (existing) {
      if (isApikey && data.allowOverwrite !== true) {
        const err = new Error(
          `A connection named "${existing.name}" already exists for provider "${data.provider}". ` +
          `Pass allowOverwrite: true to replace it.`
        );
        err.code = "PROVIDER_NAME_CONFLICT";
        err.existingId = existing.id;
        err.existingName = existing.name;
        throw err;
      }
      const normalized = resetHealthStateOnActivation(existing, data);
      const merged = { ...existing, ...normalized, updatedAt: now };
      upsert(db, merged);
      result = merged;
      return;
    }

    let connectionName = data.name || null;
    if (!connectionName && (data.authType === "oauth" || data.authType === "access_token")) {
      connectionName = deriveConnectionName(data, data.email || `Account ${poolSize + 1}`);
    }
    let connectionPriority = data.priority;
    if (!connectionPriority) {
      const maxRow = db.get(`SELECT MAX(priority) AS m FROM providerConnections WHERE provider = ?`, [data.provider]);
      connectionPriority = (maxRow?.m || 0) + 1;
    }

    const conn = {
      id: uuidv4(),
      provider: data.provider,
      authType: data.authType || "oauth",
      name: connectionName,
      priority: connectionPriority,
      isActive: data.isActive !== undefined ? data.isActive : true,
      createdAt: now,
      updatedAt: now,
    };
    for (const f of OPTIONAL_FIELDS) {
      if (data[f] !== undefined && data[f] !== null) conn[f] = data[f];
    }
    if (data.providerSpecificData && Object.keys(data.providerSpecificData).length > 0) {
      conn.providerSpecificData = data.providerSpecificData;
    }
    if (data.email !== undefined) conn.email = data.email;

    upsert(db, conn);
    result = conn;
  });

  if (result) await invalidateConnectionCacheEverywhere();
  return result;
}

export async function updateProviderConnection(id, data) {
  const reorders = data.priority !== undefined;
  if (reorders) invalidateConnectionCache();
  else optimisticPatchCachedConnection(id, data);
  const db = await getAdapter();
  let result;
  try {
    db.transaction(() => {
      const row = db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
      if (!row) { result = null; return; }
      const existing = rowToConn(row);
      const normalized = resetHealthStateOnActivation(existing, data);
      const merged = pruneClearedLocks({ ...existing, ...normalized, updatedAt: new Date().toISOString() });
      upsert(db, merged);
      if (reorders) reorderInTx(db, existing.provider);
      result = merged;
      if (!reorders) patchCachedConnection(rowToConn(db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id])));
    });
  } catch (e) {
    invalidateConnectionCache();
    throw e;
  }
  if (!result) invalidateConnectionCache();
  if (result) await invalidateConnectionCacheEverywhere({ localDone: !reorders });
  return result;
}

export async function mutateProviderConnection(id, mutate) {
  const db = await getAdapter();
  let result = null;
  try {
    db.transaction(() => {
      const row = db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
      if (!row) return;
      const existing = rowToConn(row);
      const patch = mutate(existing);
      if (!patch) return;
      const normalized = resetHealthStateOnActivation(existing, patch);
      const merged = pruneClearedLocks({ ...existing, ...normalized, updatedAt: new Date().toISOString() });
      upsert(db, merged);
      result = merged;
      patchCachedConnection(rowToConn(db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id])));
    });
  } catch (e) {
    invalidateConnectionCache();
    throw e;
  }
  if (result) await invalidateConnectionCacheEverywhere({ localDone: true });
  return result;
}

export async function deleteProviderConnection(id) {
  const db = await getAdapter();
  let ok = false;
  db.transaction(() => {
    const row = db.get(`SELECT provider FROM providerConnections WHERE id = ?`, [id]);
    if (!row) return;
    db.run(`DELETE FROM providerConnections WHERE id = ?`, [id]);
    reorderInTx(db, row.provider);
    ok = true;
  });
  if (ok) await invalidateConnectionCacheEverywhere();
  return ok;
}

export async function deleteProviderConnectionsByProvider(providerId) {
  const db = await getAdapter();
  const before = db.get(`SELECT COUNT(*) AS n FROM providerConnections WHERE provider = ?`, [providerId]);
  db.run(`DELETE FROM providerConnections WHERE provider = ?`, [providerId]);
  if (before?.n) await invalidateConnectionCacheEverywhere();
  return before?.n || 0;
}

export async function reorderProviderConnections(providerId) {
  const db = await getAdapter();
  db.transaction(() => reorderInTx(db, providerId));
  await invalidateConnectionCacheEverywhere();
}

export async function cleanupProviderConnections() {
  const db = await getAdapter();
  const fieldsToCheck = [
    "displayName", "email", "globalPriority", "defaultModel",
    "accessToken", "refreshToken", "expiresAt", "tokenType",
    "scope", "projectId", "apiKey", "testStatus",
    "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn",
    "consecutiveUseCount",
  ];
  let cleaned = 0;
  db.transaction(() => {
    const rows = db.all(`SELECT * FROM providerConnections`);
    for (const row of rows) {
      const conn = rowToConn(row);
      let dirty = false;
      for (const f of fieldsToCheck) {
        if (conn[f] === null || conn[f] === undefined) {
          if (f in conn) { delete conn[f]; cleaned++; dirty = true; }
        }
      }
      if (conn.providerSpecificData && Object.keys(conn.providerSpecificData).length === 0) {
        delete conn.providerSpecificData;
        cleaned++;
        dirty = true;
      }
      if (dirty) upsert(db, conn);
    }
  });
  if (cleaned) await invalidateConnectionCacheEverywhere();
  return cleaned;
}
