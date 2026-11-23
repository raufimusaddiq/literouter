import fs from "node:fs";
import { Database } from "bun:sqlite";
import { describe, it, expect } from "bun:test";
import { useTempDataDir } from "#test/tempDataDir";

const temp = useTempDataDir("9router-backup-lite-");

async function seeded() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const { backupDbLite } = await import("@/lib/db/backup.js");
  const { TABLES } = await import("@/lib/db/schema.js");
  const adapter = await getAdapter();
  adapter.run(`INSERT INTO kv(scope, key, value) VALUES('pricing', 'p1', '{}'), ('pricing', 'p2', '{}')`);
  adapter.run(`INSERT INTO combos(id, name, models, createdAt, updatedAt) VALUES('c1', 'Main', '[]', 'x', 'x')`);
  adapter.run(`INSERT INTO requestDetails(id, timestamp, data) VALUES('r1', 'x', '{}')`);
  const dest = backupDbLite(adapter, temp.dir, "backup.sqlite");
  return { adapter, dest, TABLES };
}

const tableNames = (db) => db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all().map((r) => r.name).sort();

describe("backupDbLite", () => {
  it("copies every table except requestDetails", async () => {
    const { adapter, dest } = await seeded();
    expect(fs.existsSync(dest)).toBe(true);
    const bak = new Database(dest, { readonly: true });
    const expected = adapter.all(`SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).map((r) => r.name).filter((n) => n !== "requestDetails").sort();
    expect(tableNames(bak)).toEqual(expected);
    expect(tableNames(bak)).not.toContain("requestDetails");
    bak.close(true);
  });

  it("the backup opens with bun:sqlite and row counts match", async () => {
    const { adapter, dest } = await seeded();
    const bak = new Database(dest, { readonly: true });
    for (const name of tableNames(bak)) {
      const live = adapter.get(`SELECT COUNT(*) AS n FROM main.${name}`).n;
      expect(bak.query(`SELECT COUNT(*) AS n FROM ${name}`).get().n).toBe(live);
    }
    expect(bak.query(`SELECT COUNT(*) AS n FROM kv`).get().n).toBe(2);
    expect(bak.query("PRAGMA integrity_check").get().integrity_check).toBe("ok");
    bak.close(true);
  });

  it("table names that need quoting survive the CREATE TABLE rewrite", async () => {
    const { adapter, dest, TABLES } = await seeded();
    const { buildCreateTableSql } = await import("@/lib/db/schema.js");
    const bak = new Database(dest, { readonly: true });
    const backedUp = tableNames(bak);
    for (const [name, def] of Object.entries(TABLES)) {
      expect(buildCreateTableSql(name, def)).toMatch(/^CREATE TABLE IF NOT EXISTS /);
      if (name === "requestDetails") continue;
      expect(backedUp).toContain(name);
      const stored = bak.query(`SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`).get(name).sql;
      expect(stored.startsWith("CREATE TABLE")).toBe(true);
    }
    bak.close(true);
    expect(adapter.get(`SELECT COUNT(*) AS n FROM combos`).n).toBe(1);
  });
});
