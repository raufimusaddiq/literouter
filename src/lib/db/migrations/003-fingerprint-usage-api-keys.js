import { fingerprintKey, isKeyFingerprint } from "open-sse/utils/keyFingerprint.js";

// Issue #136: usageHistory.apiKey and usageDaily.byApiKey stored client keys in
// plaintext. New writes are fingerprinted; this rewrites rows written before.
// It is idempotent (fingerprints are left alone). It cannot scrub bytes SQLite
// already freed, nor earlier backups or request-log files: see CHANGELOG.
function hasTable(db, name) {
  return !!db.get(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`, [name]);
}

function rewriteHistory(db) {
  const rows = db.all(`SELECT DISTINCT apiKey FROM usageHistory WHERE apiKey IS NOT NULL AND apiKey != ''`);
  for (const { apiKey } of rows) {
    if (isKeyFingerprint(apiKey)) continue;
    db.run(`UPDATE usageHistory SET apiKey = ? WHERE apiKey = ?`, [fingerprintKey(apiKey), apiKey]);
  }
}

function rewriteDay(data) {
  const day = JSON.parse(data);
  const buckets = day.byApiKey;
  if (!buckets || typeof buckets !== "object") return null;

  const next = {};
  let changed = false;
  for (const [key, bucket] of Object.entries(buckets)) {
    const raw = typeof bucket?.apiKey === "string" ? bucket.apiKey : null;
    const fp = fingerprintKey(raw);
    if (!fp || fp === raw) {
      next[key] = bucket;
      continue;
    }
    changed = true;
    const newKey = `${fp}|${bucket.rawModel}|${bucket.provider || "unknown"}`;
    const merged = next[newKey];
    if (merged) {
      for (const f of ["requests", "promptTokens", "completionTokens", "cachedTokens", "cost"]) {
        merged[f] = (merged[f] || 0) + (bucket[f] || 0);
      }
    } else {
      next[newKey] = { ...bucket, apiKey: fp };
    }
  }
  if (!changed) return null;
  day.byApiKey = next;
  return JSON.stringify(day);
}

export default {
  version: 3,
  name: "fingerprint-usage-api-keys",
  up(db) {
    if (hasTable(db, "usageHistory")) rewriteHistory(db);
    if (!hasTable(db, "usageDaily")) return;
    for (const { dateKey, data } of db.all(`SELECT dateKey, data FROM usageDaily`)) {
      let out;
      try { out = rewriteDay(data); } catch { continue; }
      if (out) db.run(`UPDATE usageDaily SET data = ? WHERE dateKey = ?`, [out, dateKey]);
    }
  },
};
