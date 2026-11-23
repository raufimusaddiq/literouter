import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { vi } from "#test/vi";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let auth;

vi.mock("@/lib/network/connectionProxy", () => ({ pickProxyPoolId: vi.fn(), resolveConnectionProxyConfig: vi.fn() }));

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-lock-repo-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  auth = await import("../../src/sse/services/auth.js");
});

afterAll(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

const lockKeys = (c) => Object.keys(c).filter((k) => k.startsWith("modelLock_"));

describe("connection locks in the repo", () => {
  it("concurrent 429s each see the previous level (1..N), no lost increments", async () => {
    const c = await db.createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "k1", name: "race" });
    await Promise.all(Array.from({ length: 5 }, () => auth.markAccountUnavailable(c.id, 429, "rate limit", "openai", "m")));
    const back = await db.getProviderConnectionById(c.id);
    expect(back.backoffLevel).toBe(5);
  });

  it("request-scoped error writes nothing", async () => {
    const c = await db.createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "k2", name: "req" });
    const before = (await db.getProviderConnectionById(c.id)).updatedAt;
    const r = await auth.markAccountUnavailable(c.id, 400, "Improperly formed request.", "kiro", "m");
    expect(r.shouldFallback).toBe(false);
    const back = await db.getProviderConnectionById(c.id);
    expect(back.updatedAt).toBe(before);
    expect(lockKeys(back)).toEqual([]);
  });

  it("clearing a lock deletes the key; a following success is a no-write", async () => {
    const c = await db.createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "k3", name: "clear" });
    await auth.markAccountUnavailable(c.id, 503, "boom", "openai", "m");
    let locked = await db.getProviderConnectionById(c.id);
    expect(lockKeys(locked)).toEqual(["modelLock_m"]);

    await auth.clearAccountError(c.id, locked, "m");
    const cleared = await db.getProviderConnectionById(c.id);
    expect(lockKeys(cleared)).toEqual([]);
    expect(cleared.testStatus).toBe("active");

    const stamp = cleared.updatedAt;
    await auth.clearAccountError(c.id, cleared, "m");
    await auth.clearAccountError(c.id, cleared, "other");
    expect((await db.getProviderConnectionById(c.id)).updatedAt).toBe(stamp);
  });

  it("legacy rows carrying modelLock_*: null are read clean and succeed without a write", async () => {
    const c = await db.createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "k4", name: "legacy" });
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const row = adapter.get("SELECT data FROM providerConnections WHERE id = ?", [c.id]);
    const data = { ...JSON.parse(row.data), modelLock___all: null, modelLock_x: null, testStatus: "active" };
    adapter.run("UPDATE providerConnections SET data = ? WHERE id = ?", [JSON.stringify(data), c.id]);
    db.invalidateConnectionCache?.();

    const read = await db.getProviderConnectionById(c.id);
    expect(lockKeys(read)).toEqual([]);
    const stamp = read.updatedAt;
    await auth.clearAccountError(c.id, read, "x");
    expect((await db.getProviderConnectionById(c.id)).updatedAt).toBe(stamp);
  });
});
