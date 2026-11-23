import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { sanitizeSoakDb } from "../../scripts/cutover/sanitize-soak-db.mjs";

let dir;
let dbPath;

function seed(rows, { withTable = true } = {}) {
  const db = new Database(dbPath, { create: true });
  if (withTable) {
    db.exec("CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL, authType TEXT, isActive INTEGER DEFAULT 1, data TEXT NOT NULL)");
    const ins = db.prepare("INSERT INTO providerConnections(id, provider, authType, isActive, data) VALUES(?, ?, ?, 1, ?)");
    for (const [id, authType] of rows) ins.run(id, "p", authType, "{}");
  } else {
    db.exec("CREATE TABLE other (id TEXT)");
  }
  db.close(true);
}

function active() {
  const db = new Database(dbPath, { readonly: true });
  const out = Object.fromEntries(db.query("SELECT id, isActive FROM providerConnections").all().map((r) => [r.id, r.isActive]));
  db.close(true);
  return out;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "soak-sanitize-"));
  dbPath = path.join(dir, "data.sqlite");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("sanitizeSoakDb", () => {
  it("deactivates oauth, cookie and access_token connections", () => {
    seed([["a", "oauth"], ["b", "cookie"], ["c", "access_token"]]);
    expect(sanitizeSoakDb(dbPath)).toEqual({ deactivated: 3, kept: 0 });
    expect(active()).toEqual({ a: 0, b: 0, c: 0 });
  });

  it("keeps apikey, api_key and none connections active", () => {
    seed([["a", "apikey"], ["b", "api_key"], ["c", "none"]]);
    expect(sanitizeSoakDb(dbPath)).toEqual({ deactivated: 0, kept: 3 });
    expect(active()).toEqual({ a: 1, b: 1, c: 1 });
  });

  it("deactivates NULL, empty and unknown authType", () => {
    seed([["a", null], ["b", ""], ["c", "mystery"], ["d", "apikey"]]);
    expect(sanitizeSoakDb(dbPath)).toEqual({ deactivated: 3, kept: 1 });
    expect(active()).toEqual({ a: 0, b: 0, c: 0, d: 1 });
  });

  it("returns counts and is idempotent", () => {
    seed([["a", "oauth"], ["b", "apikey"], ["c", "cookie"]]);
    expect(sanitizeSoakDb(dbPath)).toEqual({ deactivated: 2, kept: 1 });
    expect(sanitizeSoakDb(dbPath)).toEqual({ deactivated: 2, kept: 1 });
    expect(active()).toEqual({ a: 0, b: 1, c: 0 });
  });

  it("throws on a missing providerConnections table", () => {
    seed([], { withTable: false });
    expect(() => sanitizeSoakDb(dbPath)).toThrow();
  });

  it("throws and does not create a file when the path is missing", () => {
    const missing = path.join(dir, "nope.sqlite");
    expect(() => sanitizeSoakDb(missing)).toThrow();
    expect(fs.existsSync(missing)).toBe(false);
  });
});
