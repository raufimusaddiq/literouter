import { describe, it, expect } from "bun:test";
import { useTempDataDir } from "#test/tempDataDir";

useTempDataDir("9router-pragmas-");

const pragma = (db, name) => Object.values(db.get(`PRAGMA ${name}`))[0];

describe("bun:sqlite adapter", () => {
  it("opens in WAL with the documented pragmas", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    expect(db.driver).toBe("bun:sqlite");
    expect(pragma(db, "journal_mode")).toBe("wal");
    expect(pragma(db, "synchronous")).toBe(1);
    expect(pragma(db, "temp_store")).toBe(2);
    expect(pragma(db, "cache_size")).toBe(-16000);
    expect(pragma(db, "wal_autocheckpoint")).toBe(1000);
    expect(pragma(db, "foreign_keys")).toBe(1);
    expect(pragma(db, "busy_timeout")).toBe(5000);
  });

  it("user_version/_meta schema version equals SCHEMA_VERSION", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { SCHEMA_VERSION } = await import("@/lib/db/schema.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db = await getAdapter();
    const meta = Object.fromEntries(db.all(`SELECT key, value FROM _meta`).map((r) => [r.key, r.value]));
    expect(Number(meta.backupSchemaVersion)).toBe(SCHEMA_VERSION);
    expect(Number(meta.schemaVersion)).toBe(latestVersion());
    expect(pragma(db, "user_version")).toBe(0);
  });

  it("a second open of the same file in the same process reuses one connection", async () => {
    const { getAdapter, getAdapterSync } = await import("@/lib/db/driver.js");
    const [a, b] = await Promise.all([getAdapter(), getAdapter()]);
    expect(a).toBe(b);
    expect(getAdapterSync()).toBe(a);
    expect(await getAdapter()).toBe(a);
  });
});
