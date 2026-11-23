import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { vi } from "#test/vi";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-chain-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("Driver chain under Bun", () => {
  it("selects bun:sqlite first", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    expect(process.versions.bun).toBeTruthy();
    expect(db.driver).toBe("bun:sqlite");
  });

  it("wraps the adapter so null bytes are stripped from bound params", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run("CREATE TABLE nul_probe (id INTEGER PRIMARY KEY, v TEXT)");
    db.run("INSERT INTO nul_probe (id, v) VALUES (?, ?)", [1, "a\u0000b"]);
    expect(db.get("SELECT v FROM nul_probe WHERE id = ?", [1]).v).toBe("ab");
    expect(db.all("SELECT v FROM nul_probe WHERE v = ?", ["a\u0000b"]).map((r) => r.v)).toEqual(["ab"]);
  });

  it("releases the database file on close so the data dir can be removed", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run("CREATE TABLE close_probe (id INTEGER)");
    db.run("INSERT INTO close_probe (id) VALUES (?)", [1]);
    db.close();
    expect(() => fs.rmSync(tempDir, { recursive: true })).not.toThrow();
    fs.mkdirSync(tempDir, { recursive: true });
  });

  it("refuses to start outside the Bun runtime", async () => {
    const original = Object.getOwnPropertyDescriptor(process.versions, "bun");
    Object.defineProperty(process.versions, "bun", { value: undefined, configurable: true });
    try {
      const { getAdapter } = await import("@/lib/db/driver.js");
      await expect(getAdapter()).rejects.toThrow("LiteRouter requires the Bun runtime (bun:sqlite)");
    } finally {
      Object.defineProperty(process.versions, "bun", original);
    }
  });
});
