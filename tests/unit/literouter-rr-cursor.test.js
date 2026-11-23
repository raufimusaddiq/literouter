import { describe, expect, it, beforeAll } from "bun:test";

import { useTempDataDir } from "#test/tempDataDir";

useTempDataDir("9router-rr-cursor-", { scope: "all" });

const PROVIDER = "rr-cursor-test";
let created = [];
let db;
let auth;

beforeAll(async () => {
  db = await import("@/lib/db/index.js");
  auth = await import("@/sse/services/auth.js");
  for (let i = 0; i < 3; i++) {
    created.push(await db.createProviderConnection({
      provider: PROVIDER,
      authType: "apikey",
      name: `rr-${i}`,
      isActive: true,
      apiKey: `k-${i}`,
    }));
  }
  await db.updateSettings({ fallbackStrategy: "round-robin", stickyRoundRobinLimit: 1 });
});

describe("round-robin account selection", () => {
  it("persists a cursor write visibly to the next selection", async () => {
    await db.getProviderConnections({ provider: PROVIDER, isActive: true });
    const cache = global.__liteRouterConnectionCache;
    expect(cache?.rows, "cache should be populated before the write").toBeTruthy();

    const pending = db.updateProviderConnection(created[0].id, {
      lastUsedAt: new Date().toISOString(),
      consecutiveUseCount: 2,
    });
    const row = global.__liteRouterConnectionCache?.rows?.find((c) => c.id === created[0].id);
    expect(
      row?.consecutiveUseCount,
      "cached row must be patched synchronously, before the first await resolves"
    ).toBe(2);
    await pending;
  });

  it("advances across consecutive selections instead of sticking", async () => {
    await db.getProviderConnections({ provider: PROVIDER, isActive: true });
    const seen = [];
    for (let i = 0; i < 6; i++) {
      const creds = await auth.getProviderCredentials(PROVIDER, null, null);
      expect(creds, `selection ${i} returned no credentials`).toBeTruthy();
      seen.push(creds.connectionId);
    }
    expect(seen[0]).not.toBe(seen[1]);
    expect(new Set(seen).size).toBe(3);
  });

  it("still distributes when selections overlap", async () => {
    await db.getProviderConnections({ provider: PROVIDER, isActive: true });
    const results = await Promise.all(
      Array.from({ length: 9 }, () => auth.getProviderCredentials(PROVIDER, null, null))
    );
    const ids = results.filter(Boolean).map((c) => c.connectionId);
    expect(ids.length).toBe(9);
    expect(new Set(ids).size).toBeGreaterThan(1);
  });
});
