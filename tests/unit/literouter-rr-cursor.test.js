import { describe, expect, it, beforeAll, afterAll } from "vitest";

// PRD 9.3: round-robin state must not require a synchronous database operation
// per request. The account cursor is now persisted in the background, so the
// correctness question is freshness: the next selection must not read a stale
// cached row, or rotation sticks on one account.
//
// Imports are direct (no catch-and-return) so a setup failure fails the suite
// instead of silently passing with zero assertions.
import * as db from "@/lib/db/index.js";
import * as auth from "@/sse/services/auth.js";

const PROVIDER = "rr-cursor-test";
let created = [];

beforeAll(async () => {
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

afterAll(async () => {
  for (const c of created) await db.deleteProviderConnection(c.id);
  await db.updateSettings({ fallbackStrategy: "fill-first" });
});

describe("round-robin account selection", () => {
  it("persists a cursor write visibly to the next selection", async () => {
    await db.getProviderConnections({ provider: PROVIDER, isActive: true });
    const cache = global.__liteRouterConnectionCache;
    expect(cache?.rows, "cache should be populated before the write").toBeTruthy();

    // Kick off the write without awaiting: this is what the routing path does
    // now. The snapshot must already be invalidated when this returns, because
    // getAdapter() is async and the request path does not wait for it.
    const pending = db.updateProviderConnection(created[0].id, {
      lastUsedAt: new Date().toISOString(),
      consecutiveUseCount: 2,
    });
    expect(
      global.__liteRouterConnectionCache?.rows,
      "cache must be cleared synchronously, before the first await resolves"
    ).toBeNull();
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
    // stickyRoundRobinLimit is 1, so consecutive picks must differ and all three
    // accounts must be reached within six attempts.
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
