function columnNames(db, table) {
  try {
    return new Set(db.all(`PRAGMA table_info(${table})`).map((r) => r.name));
  } catch {
    return new Set();
  }
}

export default {
  version: 6,
  name: "key-budgets",
  up(db) {
    const cols = columnNames(db, "apiKeys");
    if (cols.size) {
      if (!cols.has("budgetPeriod")) db.run(`ALTER TABLE apiKeys ADD COLUMN budgetPeriod TEXT`);
      if (!cols.has("budgetMaxTokens")) db.run(`ALTER TABLE apiKeys ADD COLUMN budgetMaxTokens INTEGER`);
      if (!cols.has("budgetMaxCost")) db.run(`ALTER TABLE apiKeys ADD COLUMN budgetMaxCost REAL`);
    }
    db.run(
      `CREATE TABLE IF NOT EXISTS apiKeyBudgetSpend (
        keyId TEXT NOT NULL,
        window TEXT NOT NULL,
        tokens INTEGER NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (keyId, window)
      )`
    );
  },
};
