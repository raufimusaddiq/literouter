// getApiKeyUsageRows (endpoint page) groups usageHistory by apiKey and reads
// MAX(timestamp) per key. This composite index lets both run off the index
// instead of scanning the whole table. IF NOT EXISTS keeps it idempotent and
// it is plain SQL, so it behaves the same on every adapter.
function hasTable(db, name) {
  return !!db.get(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`, [name]);
}

export default {
  version: 4,
  name: "usage-history-apikey-index",
  up(db) {
    if (!hasTable(db, "usageHistory")) return;
    db.run(`CREATE INDEX IF NOT EXISTS idx_usageHistory_apiKey_timestamp ON usageHistory(apiKey, timestamp)`);
  },
};
