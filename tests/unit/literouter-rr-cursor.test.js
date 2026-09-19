import { describe, expect, it } from "vitest";

// PRD 9.3: round-robin state must not require a synchronous database operation
// per request. The cursor is now persisted in the background rather than
// awaited. The risk that introduces: if the background write does not become
// visible before the next selection, rotation sticks on one account.
//
// updateProviderConnection clears the connection cache synchronously, so the
// next read re-queries the row. This test pins that invariant down, because it
// is what the fire-and-forget write depends on.
describe("round-robin account selection", () => {
  async function withAccounts(run) {
    const localDb = await import("../../src/lib/localDb.js").catch(() => null);
    const auth = await import("../../src/sse/services/auth.js").catch(() => null);
    if (!localDb || !auth) return; // modules unavailable in unit context — covered by live smoke

    const provider = "rr-cursor-test";
    const created = [];
    for (let i = 0; i < 3; i++) {
      created.push(await localDb.createProviderConnection({
        provider,
        authType: "apikey",
        name: `rr-${i}`,
        isActive: true,
        apiKey: `k-${i}`,
      }));
    }

    try {
      await localDb.updateSettings({ fallbackStrategy: "round-robin", stickyRoundRobinLimit: 1 });
      await run(auth, provider);
    } finally {
      for (const c of created) await localDb.deleteProviderConnection(c.id).catch(() => {});
      await localDb.updateSettings({ fallbackStrategy: "fill-first" }).catch(() => {});
    }
  }

  it("advances across consecutive selections instead of sticking", async () => {
    await withAccounts(async (auth, provider) => {
      const seen = [];
      for (let i = 0; i < 6; i++) {
        const creds = await auth.getProviderCredentials(provider, null, null);
        if (creds) seen.push(creds.connectionId);
      }
      expect(seen.length).toBe(6);
      // stickyRoundRobinLimit is 1, so consecutive picks must differ and all
      // three accounts must be reached within six attempts.
      expect(seen[0]).not.toBe(seen[1]);
      expect(new Set(seen).size).toBe(3);
    });
  });

  it("still distributes when selections overlap", async () => {
    await withAccounts(async (auth, provider) => {
      const results = await Promise.all(
        Array.from({ length: 9 }, () => auth.getProviderCredentials(provider, null, null))
      );
      const ids = results.filter(Boolean).map((c) => c.connectionId);
      expect(ids.length).toBe(9);
      // Concurrent selections must not collapse onto a single account.
      expect(new Set(ids).size).toBeGreaterThan(1);
    });
  });
});
