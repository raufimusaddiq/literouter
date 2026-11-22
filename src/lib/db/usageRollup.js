export const ROLLUP_RETENTION_MS = 3 * 86400000;
export const bucketOf = (ts) => String(ts || "").slice(0, 15);

export const ROLLUP_TABLE_SQL = [
  `CREATE TABLE IF NOT EXISTS usageRollupKey (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', connectionId TEXT NOT NULL DEFAULT '',
    apiKey TEXT NOT NULL DEFAULT '', endpoint TEXT NOT NULL DEFAULT '',
    UNIQUE (provider, model, connectionId, apiKey, endpoint)
  )`,
  `CREATE TABLE IF NOT EXISTS usageRollup (
    bucket TEXT NOT NULL,
    keyId INTEGER NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    promptTokens INTEGER NOT NULL DEFAULT 0,
    completionTokens INTEGER NOT NULL DEFAULT 0,
    cachedTokens INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,
    firstTs TEXT NOT NULL,
    lastTs TEXT NOT NULL,
    PRIMARY KEY (bucket, keyId)
  ) WITHOUT ROWID`,
];
export function ensureRollupTables(db) { for (const sql of ROLLUP_TABLE_SQL) db.run(sql); }

const keyCaches = new WeakMap();
export function clearRollupKeyCache(db) { keyCaches.delete(db); }
export function getRollupKeyId(db, tuple) {
  let cache = keyCaches.get(db);
  if (!cache) { cache = new Map(); keyCaches.set(db, cache); }
  const k = tuple.join("\u0000");
  let id = cache.get(k);
  if (id == null) {
    db.run(`INSERT OR IGNORE INTO usageRollupKey(provider, model, connectionId, apiKey, endpoint) VALUES(?,?,?,?,?)`, tuple);
    id = db.get(`SELECT id FROM usageRollupKey WHERE provider=? AND model=? AND connectionId=? AND apiKey=? AND endpoint=?`, tuple).id;
    cache.set(k, id);
  }
  return id;
}

const tok = (a, b, col) =>
  `COALESCE(NULLIF(CASE WHEN json_valid(tokens) THEN COALESCE(NULLIF(json_extract(tokens,'$.${a}'),0),json_extract(tokens,'$.${b}')) END,0), NULLIF(${col},0), 0)`;

const TUPLE_EXPR = `COALESCE(provider,'') AS provider, COALESCE(model,'') AS model, COALESCE(connectionId,'') AS connectionId, COALESCE(apiKey,'') AS apiKey, COALESCE(endpoint,'') AS endpoint`;

export function backfillUsageRollup(db, sinceIso) {
  ensureRollupTables(db);
  db.run(`DELETE FROM usageRollup WHERE bucket >= ?`, [bucketOf(sinceIso)]);
  db.run(
    `INSERT OR IGNORE INTO usageRollupKey(provider, model, connectionId, apiKey, endpoint)
     SELECT DISTINCT ${TUPLE_EXPR} FROM usageHistory WHERE timestamp >= ?`,
    [sinceIso]
  );
  db.run(
    `INSERT INTO usageRollup(bucket, keyId, n, promptTokens, completionTokens, cachedTokens, cost, firstTs, lastTs)
     SELECT g.bucket, k.id, g.n, g.promptTokens, g.completionTokens, g.cachedTokens, g.cost, g.firstTs, g.lastTs FROM (
       SELECT substr(timestamp,1,15) AS bucket, ${TUPLE_EXPR}, COUNT(*) AS n,
         SUM(${tok("prompt_tokens", "input_tokens", "promptTokens")}) AS promptTokens,
         SUM(${tok("completion_tokens", "output_tokens", "completionTokens")}) AS completionTokens,
         SUM(CASE WHEN json_valid(tokens) THEN COALESCE(NULLIF(json_extract(tokens,'$.cached_tokens'),0), json_extract(tokens,'$.cache_read_input_tokens'), 0) ELSE 0 END) AS cachedTokens,
         SUM(COALESCE(cost,0)) AS cost, MIN(timestamp) AS firstTs, MAX(timestamp) AS lastTs
       FROM usageHistory WHERE timestamp >= ? GROUP BY 1,2,3,4,5,6
     ) g JOIN usageRollupKey k ON k.provider=g.provider AND k.model=g.model AND k.connectionId=g.connectionId AND k.apiKey=g.apiKey AND k.endpoint=g.endpoint`,
    [sinceIso]
  );
}
