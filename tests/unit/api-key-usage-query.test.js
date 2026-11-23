import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "bun:test";
import { useTempDataDir } from "#test/tempDataDir";

useTempDataDir("9router-keyusage-", { scope: "all" });
let db;
let getApiKeyUsageRows;
const NOW = Date.parse("2026-06-01T12:00:00.000Z");
const ROWS = 200_000;
const KEYS = Array.from({ length: 6 }, (_, i) => `fp_key${i}`);

const OLD_SQL = `SELECT apiKey, SUM(CASE WHEN timestamp >= ? THEN 1 ELSE 0 END) AS requests24h, MAX(timestamp) AS lastUsed
  FROM usageHistory WHERE apiKey IS NOT NULL AND apiKey <> '' GROUP BY apiKey`;

const byKey = (rows) => Object.fromEntries(rows.map((r) => [r.apiKey, { requests24h: r.requests24h, lastUsed: r.lastUsed }]));
const time = async (fn) => { const t = performance.now(); const r = await fn(); return [r, performance.now() - t]; };

beforeAll(async () => {
  const { getAdapter } = await import("@/lib/db/driver.js");
  ({ getApiKeyUsageRows } = await import("@/lib/db/repos/usageRepo.js"));
  db = await getAdapter();
  const start = NOW - 90 * 24 * 3600 * 1000;
  const step = Math.floor((NOW - start) / ROWS);
  db.run("BEGIN");
  for (let i = 0; i < ROWS; i++) {
    const m = i % 8;
    const apiKey = m === 6 ? null : m === 7 ? "" : KEYS[i % 6];
    db.run(`INSERT INTO usageHistory(timestamp, provider, model, apiKey) VALUES(?, 'p', 'm', ?)`, [new Date(start + i * step).toISOString(), apiKey]);
  }
  db.run(`INSERT INTO usageHistory(timestamp, provider, model, apiKey) VALUES(?, 'p', 'm', 'fp_old')`, [new Date(NOW - 5 * 24 * 3600 * 1000).toISOString()]);
  db.run("COMMIT");
}, 120_000);


describe("getApiKeyUsageRows", () => {
  it("creates the apiKey/timestamp index", () => {
    const idx = db.get(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_usageHistory_apiKey_timestamp'`);
    expect(idx).toBeTruthy();
  });

  it("matches the old full-scan query and is fast", async () => {
    const since = new Date(NOW - 24 * 3600 * 1000).toISOString();
    const [oldRows, oldMs] = await time(() => db.all(OLD_SQL, [since]));
    await getApiKeyUsageRows(NOW);
    const [newRows, newMs] = await time(() => getApiKeyUsageRows(NOW));
    process.stderr.write(`[bench] ${ROWS} rows: old=${oldMs.toFixed(1)}ms new=${newMs.toFixed(1)}ms
`);
    expect(byKey(newRows)).toEqual(byKey(oldRows));
    expect(Object.keys(byKey(newRows)).sort()).toEqual([...KEYS, "fp_old"].sort());
    expect(byKey(newRows).fp_old.requests24h).toBe(0);
    expect(newMs).toBeLessThan(200);
  });

  it("returns [] when no usage has an apiKey", async () => {
    db.run(`DELETE FROM usageHistory`);
    expect(await getApiKeyUsageRows(NOW)).toEqual([]);
  });
});
