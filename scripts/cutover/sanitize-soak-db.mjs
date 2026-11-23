import { Database } from "bun:sqlite";

const KEEP_AUTH_TYPES = ["apikey", "api_key", "none"];
const KEEP_SQL = KEEP_AUTH_TYPES.map((t) => `'${t}'`).join(", ");
const NOT_KEPT = `(authType IS NULL OR authType NOT IN (${KEEP_SQL}))`;

export function sanitizeSoakDb(dbPath) {
  const db = new Database(dbPath, { readwrite: true });
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.query("UPDATE providerConnections SET isActive = 0 WHERE " + NOT_KEPT).run();
      const deactivated = db.query("SELECT COUNT(*) AS n FROM providerConnections WHERE " + NOT_KEPT).get().n;
      const kept = db.query("SELECT COUNT(*) AS n FROM providerConnections WHERE NOT " + NOT_KEPT).get().n;
      db.exec("COMMIT");
      return { deactivated, kept };
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } finally {
    db.close(true);
  }
}

if (import.meta.main) {
  const dbPath = process.argv[2];
  if (!dbPath) {
    console.error("usage: bun scripts/cutover/sanitize-soak-db.mjs <dbPath>");
    process.exit(2);
  }
  const { deactivated, kept } = sanitizeSoakDb(dbPath);
  console.log(`deactivated=${deactivated} kept=${kept}`);
}
