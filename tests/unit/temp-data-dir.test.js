import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "bun:test";
import { useTempDataDir } from "#test/tempDataDir";

describe("useTempDataDir", () => {
  const seen = {};
  const temp = useTempDataDir("9router-tempdir-");

  it("opens a DB with a write inside the temp dir", async () => {
    expect(process.env.DATA_DIR).toBe(temp.dir);
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    await db.createApiKey("helper-probe", "machine-1");
    seen.dir = temp.dir;
    expect(fs.existsSync(path.join(temp.dir, "db", "data.sqlite"))).toBe(true);
  });

  it("removed the previous dir, with no wal/shm left behind", () => {
    expect(seen.dir).toBeTruthy();
    expect(fs.existsSync(seen.dir)).toBe(false);
    expect(temp.dir).not.toBe(seen.dir);
  });
});
