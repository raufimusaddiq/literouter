import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "bun:test";
import { vi } from "#test/vi";
import { useTempDataDir } from "#test/tempDataDir";
import { stripNullBytes } from "@/lib/db/helpers/nullBytes.js";

const NUL = String.fromCharCode(0);
const DIRTY = `before${NUL}after`;

useTempDataDir("9router-nul-");

describe("stripNullBytes", () => {
  it("removes NUL bytes and keeps the rest of the text", () => {
    expect(stripNullBytes(DIRTY)).toBe("beforeafter");
    expect(stripNullBytes(`a${NUL}b`)).toBe("ab");
  });

  it("leaves clean strings untouched", () => {
    expect(stripNullBytes("plain text")).toBe("plain text");
    expect(stripNullBytes("")).toBe("");
  });

  it("passes non-string values through", () => {
    expect(stripNullBytes(null)).toBe(null);
    expect(stripNullBytes(undefined)).toBe(undefined);
    expect(stripNullBytes(42)).toBe(42);
    const buf = Buffer.from([0, 1, 2]);
    expect(stripNullBytes(buf)).toBe(buf);
  });
});

describe("driver binds NUL-containing strings safely", () => {
  it("stores the whole value instead of throwing or truncating", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    db.run("CREATE TABLE IF NOT EXISTS nulTest (id INTEGER PRIMARY KEY, label TEXT)");

    expect(() => db.run("INSERT INTO nulTest (label) VALUES (?)", [DIRTY])).not.toThrow();

    const row = db.get("SELECT label FROM nulTest");
    expect(row.label).toBe("beforeafter");
  });

  it("keeps a NUL out of a lookup value too", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    db.run("CREATE TABLE IF NOT EXISTS nulLookup (id INTEGER PRIMARY KEY, label TEXT)");
    db.run("INSERT INTO nulLookup (label) VALUES (?)", [DIRTY]);

    const row = db.get("SELECT label FROM nulLookup WHERE label = ?", [DIRTY]);
    expect(row?.label).toBe("beforeafter");
  });

  it("leaves the driver identity and the other methods intact", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    expect(db.driver).toBe("bun:sqlite");
    db.run("CREATE TABLE IF NOT EXISTS nulWrap (v TEXT)");
    db.run("INSERT INTO nulWrap (v) VALUES (?)", [DIRTY]);
    expect(db.raw.query("SELECT v FROM nulWrap").get().v).toBe("beforeafter");
    expect(typeof db.exec).toBe("function");
    expect(typeof db.transaction).toBe("function");
  });
});
