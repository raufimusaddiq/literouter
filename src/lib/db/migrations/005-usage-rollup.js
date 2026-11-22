import { backfillUsageRollup, ensureRollupTables, ROLLUP_RETENTION_MS } from "../usageRollup.js";

// 24h / today dashboard stats read a 10-minute rollup instead of scanning every
// usageHistory row. Backfill covers the retention window of the rollup.
export default {
  version: 5,
  name: "usage-rollup",
  up(db) {
    ensureRollupTables(db);
    const has = db.get(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'usageHistory'`);
    if (!has) return;
    backfillUsageRollup(db, new Date(Date.now() - ROLLUP_RETENTION_MS).toISOString());
  },
};
