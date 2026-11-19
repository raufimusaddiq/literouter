import { fingerprintKey } from "open-sse/utils/keyFingerprint.js";

// Join per-fingerprint usage aggregates onto API keys. Usage rows only carry a
// non-reversible fingerprint; the response is keyed by key id so no raw key
// (or fingerprint) ever leaves the server.
// rows: [{ apiKey: "fp_…", requests24h: number, lastUsed: ISO string }]
export function mapUsageToKeys(keys, rows) {
  const byFp = new Map();
  for (const r of rows || []) {
    if (r?.apiKey) byFp.set(r.apiKey, r);
  }
  const out = {};
  for (const k of keys || []) {
    const hit = k?.key ? byFp.get(fingerprintKey(k.key)) : null;
    out[k.id] = { requests24h: hit?.requests24h || 0, lastUsed: hit?.lastUsed || null };
  }
  return out;
}
