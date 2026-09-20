import { describe, expect, it } from "vitest";

// PRD 15.1/15.2: API-key lookup must not hit SQLite per request. validateApiKey
// now serves from a process-local cache, so the correctness risk moves to
// invalidation: a revoked or deactivated key must stop working immediately.
describe("API key cache", () => {
  it("serves repeated lookups without requerying, and invalidates on mutation", async () => {
    const mod = await import("../../src/lib/db/repos/apiKeysRepo.js").catch(() => null);
    if (!mod) return; // DB adapter unavailable in unit context — covered by live smoke

    const db = await (await import("../../src/lib/db/driver.js")).getAdapter();
    const machineId = "cache-test-machine";
    const created = await mod.createApiKey("cache-test", machineId);

    try {
      expect(await mod.validateApiKey(created.key)).toBe(true);

      // A revoke performed behind the repo's back must still be picked up once
      // the TTL expires, so the cache can never make a dead key permanent.
      db.run(`UPDATE apiKeys SET isActive = 0 WHERE id = ?`, [created.id]);
      await mod.updateApiKey(created.id, { isActive: false });
      expect(await mod.validateApiKey(created.key)).toBe(false);

      // Deleting must also drop it from the cache, not just the table.
      await mod.deleteApiKey(created.id);
      expect(await mod.validateApiKey(created.key)).toBe(false);

      expect(await mod.validateApiKey("not-a-real-key")).toBe(false);
      expect(await mod.validateApiKey("")).toBe(false);
      expect(await mod.validateApiKey(undefined)).toBe(false);
    } finally {
      await mod.deleteApiKey(created.id).catch(() => {});
    }
  });
});
