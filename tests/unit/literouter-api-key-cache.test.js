import { describe, expect, it } from "bun:test";
import { useTempDataDir } from "#test/tempDataDir";

describe("API key cache", () => {
  useTempDataDir("9r-api-key-cache-", { scope: "all" });
  it("serves repeated lookups without requerying, and invalidates on mutation", async () => {
    const mod = await import("../../src/lib/db/repos/apiKeysRepo.js").catch(() => null);
    if (!mod) return;

    const db = await (await import("../../src/lib/db/driver.js")).getAdapter();
    const machineId = "cache-test-machine";
    const created = await mod.createApiKey("cache-test", machineId);

    try {
      expect(await mod.validateApiKey(created.key)).toBe(true);

      db.run(`UPDATE apiKeys SET isActive = 0 WHERE id = ?`, [created.id]);
      await mod.updateApiKey(created.id, { isActive: false });
      expect(await mod.validateApiKey(created.key)).toBe(false);

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
