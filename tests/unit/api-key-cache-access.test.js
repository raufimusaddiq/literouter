import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect } from "bun:test";
import { vi } from "#test/vi";
import { useTempDataDir } from "#test/tempDataDir";

function writeLegacyDb(dir) {
  fs.mkdirSync(path.join(dir, "db"), { recursive: true });
  const db = new DatabaseSync(path.join(dir, "db", "data.sqlite"));
  db.exec(`CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.exec(`INSERT INTO _meta(key, value) VALUES ('schemaVersion', '1'), ('backupSchemaVersion', '1')`);
  db.exec(`CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT, isActive INTEGER DEFAULT 1, createdAt TEXT NOT NULL)`);
  db.close();
}

const temp = useTempDataDir("9router-key-cache-");

describe("API-key cache", () => {
  it("preserves restricted access when resolving by key", async () => {
    writeLegacyDb(temp.dir);
    vi.resetModules();
    const { createApiKey, updateApiKey, getApiKeyByKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const access = { restricted: true, allow: ["Main"] };
    const created = await createApiKey("restricted", "machine-1");
    await updateApiKey(created.id, { access });
    expect((await getApiKeyByKey(created.key)).access).toEqual(access);
  });
});
