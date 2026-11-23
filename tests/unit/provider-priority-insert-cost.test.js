import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "bun:test";
import { vi } from "#test/vi";

const originalDataDir = process.env.DATA_DIR;
const originalAdapter = global._dbAdapter;
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "literouter-provider-priority-"));
process.env.DATA_DIR = tempDataDir;
global._dbAdapter = { instance: null, initPromise: null, logged: false };
vi.resetModules();
const { getAdapter } = await import("../../src/lib/db/driver.js");

const {
  createProviderConnection,
  getProviderConnections,
  deleteProviderConnection,
  updateProviderConnection,
} = await import("../../src/lib/db/index.js");

afterAll(() => {
  try {
    global._dbAdapter.instance?.close();
  } finally {
    global._dbAdapter = originalAdapter;
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
});


async function seed(provider, n) {
  for (let i = 0; i < n; i++) {
    await createProviderConnection({
      provider,
      authType: "apikey",
      name: `seed-${i}`,
      apiKey: `k${i}`,
    });
  }
}

describe("provider insert is O(1) in pool size (#4311)", () => {
  it.each([
    ["gaps", [2, 7, 11]],
    ["duplicates", [7, 7, 11]],
  ])("appends above legacy %s without rewriting the pool", async (label, priorities) => {
    const provider = `openai-compatible-legacy-${label}-${Date.now()}`;
    await seed(provider, priorities.length);
    const db = await getAdapter();
    priorities.forEach((priority, i) => db.run(
      "UPDATE providerConnections SET priority = ? WHERE provider = ? AND name = ?",
      [priority, provider, `seed-${i}`],
    ));
    const appended = await createProviderConnection({ provider, authType: "apikey", name: "appended", apiKey: "new" });
    expect(appended.priority).toBe(12);
    const list = await getProviderConnections({ provider });
    expect(list.map((connection) => connection.priority)).toEqual([...priorities, 12]);
    expect(list.filter((connection) => connection.id !== appended.id).map((connection) => connection.apiKey).sort())
      .toEqual(["k0", "k1", "k2"]);
  });

  it("assigns sequential priorities without a renumber pass", async () => {
    const P = `openai-compatible-seq-${Date.now()}`;
    await seed(P, 3);
    const list = await getProviderConnections({ provider: P });
    expect(list.map((c) => c.name)).toEqual(["seed-0", "seed-1", "seed-2"]);
    expect(list.map((c) => c.priority)).toEqual([1, 2, 3]);
  });

  it("keeps a large pool in insertion order", async () => {
    const P = `openai-compatible-ord-${Date.now()}`;
    await seed(P, 60);
    const list = await getProviderConnections({ provider: P });
    expect(list).toHaveLength(60);
    expect(list[0].name).toBe("seed-0");
    expect(list[59].name).toBe("seed-59");
    for (let i = 1; i < list.length; i++) {
      expect(list[i].priority).toBeGreaterThan(list[i - 1].priority);
    }
  });

  it("still renumbers on delete, so gaps do not accumulate", async () => {
    const P = `openai-compatible-del-${Date.now()}`;
    await seed(P, 4);
    const before = await getProviderConnections({ provider: P });
    await deleteProviderConnection(before[0].id);
    const after = await getProviderConnections({ provider: P });
    expect(after.map((c) => c.priority)).toEqual([1, 2, 3]);
  });

  it("still renumbers on an explicit priority update", async () => {
    const P = `openai-compatible-upd-${Date.now()}`;
    await seed(P, 4);
    await new Promise((r) => setTimeout(r, 10));
    const list = await getProviderConnections({ provider: P });
    await updateProviderConnection(list[3].id, { priority: 1 });
    const after = await getProviderConnections({ provider: P });
    expect(after[0].name).toBe("seed-3");
  });
});

describe("name collision no longer destroys a key silently (#4311)", () => {
  const P = `openai-compatible-clash-${Date.now()}`;
  const original = (async () => {
    await seed(P, 1);
    return (await getProviderConnections({ provider: P }))[0];
  })();

  it("throws a typed conflict instead of overwriting, when overwrite is refused", async () => {
    const orig = await original;
    await expect(
      createProviderConnection({
        provider: P,
        authType: "apikey",
        name: orig.name,
        apiKey: "REPLACEMENT-KEY",
        allowOverwrite: false,
      })
    ).rejects.toMatchObject({ code: "PROVIDER_NAME_CONFLICT", existingId: orig.id });

    const after = (await getProviderConnections({ provider: P }))[0];
    expect(after.apiKey).toBe(orig.apiKey);
  });

  it("still overwrites when the caller opts in", async () => {
    const orig = await original;
    const updated = await createProviderConnection({
      provider: P,
      authType: "apikey",
      name: orig.name,
      apiKey: "REPLACEMENT-KEY",
      allowOverwrite: true,
    });
    expect(updated.id).toBe(orig.id);
    const after = (await getProviderConnections({ provider: P }))[0];
    expect(after.apiKey).toBe("REPLACEMENT-KEY");
  });

  it("rejects an omitted overwrite flag without changing credentials", async () => {
    const orig = await original;
    const before = (await getProviderConnections({ provider: P }))[0];
    await expect(createProviderConnection({
      provider: P,
      authType: "apikey",
      name: orig.name,
      apiKey: "LEGACY-PATH-KEY",
    })).rejects.toMatchObject({ code: "PROVIDER_NAME_CONFLICT", existingId: orig.id });
    expect((await getProviderConnections({ provider: P }))[0]).toEqual(before);
  });

  it("does not collide across different providers", async () => {
    const orig = await original;
    const other = await createProviderConnection({
      provider: `openai-compatible-other-${Date.now()}`,
      authType: "apikey",
      name: orig.name,
      apiKey: "other-key",
    });
    expect(other.id).not.toBe(orig.id);
  });
});
