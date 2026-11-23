import { backfillUsageRollup, ensureRollupTables, ROLLUP_RETENTION_MS } from "../usageRollup.js";

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
