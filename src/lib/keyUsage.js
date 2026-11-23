import { fingerprintKey } from "open-sse/utils/keyFingerprint.js";

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
