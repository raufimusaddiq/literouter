import fs from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { describe, it, expect } from "bun:test";
import { vi } from "#test/vi";
import { useTempDataDir } from "#test/tempDataDir";

const FIXTURES = path.join(import.meta.dir, "..", "fixtures", "db");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));

const temp = useTempDataDir("9router-compat-");

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}

async function boot() {
  vi.resetModules();
  return import("@/lib/db/index.js");
}

describe("export/import and file compatibility with main", () => {
  it("main's export imports and re-exports identically", async () => {
    const db = await boot();
    const mainExport = readJson("main-export.json");
    await db.importDb(mainExport);
    expect(await db.exportDb()).toEqual(mainExport);
  });

  it("export from the new build equals main's export for the same seed", async () => {
    const db = await boot();
    await db.importDb(readJson("legacy-main.seed.json"));
    expect(JSON.stringify(sortKeys(await db.exportDb()))).toBe(JSON.stringify(sortKeys(readJson("main-export.json"))));
  });

  it("a DB file written by main opens unchanged, applying only newer migrations", async () => {
    const dbDir = path.join(temp.dir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    const file = path.join(dbDir, "data.sqlite");
    fs.copyFileSync(path.join(FIXTURES, "main-written.sqlite"), file);

    const peek = new Database(file, { readonly: true });
    const before = Object.fromEntries(peek.query(`SELECT key, value FROM _meta`).all().map((r) => [r.key, r.value]));
    peek.close(true);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const db = await boot();
    const exported = await db.exportDb();
    const applied = log.mock.calls
      .map((c) => String(c[0]))
      .filter((line) => line.includes("[DB][migrate] applied"))
      .map((line) => line.replace(/^.*applied #(\d+) (\S+).*$/, "#$1 $2"));
    log.mockRestore();

    const { MIGRATIONS, latestVersion } = await import("@/lib/db/migrations/index.js");
    const { SCHEMA_VERSION } = await import("@/lib/db/schema.js");
    const expected = MIGRATIONS
      .filter((m) => m.version > Number(before.schemaVersion))
      .map((m) => `#${m.version} ${m.name}`);
    expect(expected.length).toBeGreaterThan(0);
    expect(applied).toEqual(expected);

    expect(exported).toEqual(readJson("main-export.json"));
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const after = Object.fromEntries(adapter.all(`SELECT key, value FROM _meta`).map((r) => [r.key, r.value]));
    expect(after.schemaVersion).toBe(String(latestVersion()));
    expect(after.backupSchemaVersion).toBe(String(SCHEMA_VERSION));
    expect(Number(before.backupSchemaVersion)).toBe(SCHEMA_VERSION - 1);
    const backups = fs.readdirSync(path.join(dbDir, "backups"));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(new RegExp(`^schema-${before.backupSchemaVersion}-to-${SCHEMA_VERSION}-`));
    const snapshot = new Database(path.join(dbDir, "backups", backups[0], "data.sqlite"), { readonly: true });
    const snapMeta = Object.fromEntries(snapshot.query(`SELECT key, value FROM _meta`).all().map((r) => [r.key, r.value]));
    snapshot.close(true);
    expect(snapMeta.schemaVersion).toBe(before.schemaVersion);
    expect(snapMeta.backupSchemaVersion).toBe(before.backupSchemaVersion);
  });

  it("a DB file written by the new build passes integrity_check and keeps WAL", async () => {
    const db = await boot();
    await db.importDb(readJson("main-export.json"));
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    adapter.checkpoint();
    const file = path.join(temp.dir, "db", "data.sqlite");
    const copy = path.join(temp.dir, "copy.sqlite");
    fs.copyFileSync(file, copy);
    const check = new Database(copy, { readonly: true });
    expect(check.query("PRAGMA integrity_check").get().integrity_check).toBe("ok");
    expect(check.query("PRAGMA journal_mode").get().journal_mode).toBe("wal");
    check.close(true);
    expect(Object.values(adapter.get("PRAGMA journal_mode"))[0]).toBe("wal");
  });
});
