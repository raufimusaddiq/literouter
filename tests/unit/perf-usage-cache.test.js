import { beforeEach, describe, expect, it } from "bun:test";
import { vi } from "#test/vi";

const mocks = vi.hoisted(() => {
  const rows = new Map();
  const db = {
    transaction: vi.fn((fn) => fn()),
    all: vi.fn((sql) => (/FROM providerConnections/.test(sql) ? [...rows.values()] : [])),
    get: vi.fn((sql, params) => (/WHERE id = \?/.test(sql) ? rows.get(params[0]) || null : null)),
    run: vi.fn((sql, params) => {
      if (/DELETE FROM usageHistory/.test(sql)) return { changes: 7 };
      if (/INSERT INTO providerConnections/.test(sql)) {
        const [id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt] = params;
        rows.set(id, { id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt });
      }
      return { changes: 1 };
    }),
  };
  return { rows, db };
});

vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: vi.fn(async () => mocks.db),
  getAdapterSync: vi.fn(() => mocks.db),
}));
vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettings: vi.fn(async () => ({ usageHistoryRetentionDays: 30 })),
}));

const repo = await import("@/lib/db/repos/connectionsRepo.js");
const usage = await import("@/lib/db/repos/usageRepo.js");

describe("connection cache", () => {
  const seed = (id, priority) => mocks.rows.set(id, {
    id, provider: "openai", authType: "apikey", name: id, email: null, priority,
    isActive: 1, data: "{}", createdAt: "t", updatedAt: "t",
  });

  beforeEach(() => {
    mocks.rows.clear();
    seed("a", 1); seed("b", 2);
    global.__liteRouterConnectionCache = { rows: null, expiresAt: 0, versionCheckedAt: 0 };
  });

  it("patches the cached row in place without reloading the pool", async () => {
    await repo.getProviderConnections({});
    mocks.db.all.mockClear();
    await repo.updateProviderConnection("a", { testStatus: "error", lastError: "boom" });
    const list = await repo.getProviderConnections({}, { clone: false });
    expect(list.find((c) => c.id === "a").lastError).toBe("boom");
    expect(mocks.db.all).not.toHaveBeenCalled();
  });

  it("drops the snapshot when priority changes (siblings renumber)", async () => {
    await repo.getProviderConnections({});
    mocks.db.all.mockClear();
    await repo.updateProviderConnection("a", { priority: 2 });
    await repo.getProviderConnections({});
    expect(mocks.db.all).toHaveBeenCalled();
  });

  it("looks a connection up by id, optionally without cloning", async () => {
    const shared = await repo.getProviderConnectionById("b", { clone: false });
    expect(await repo.getProviderConnectionById("b", { clone: false })).toBe(shared);
    expect(await repo.getProviderConnectionById("b")).not.toBe(shared);
    expect(await repo.getProviderConnectionById("zzz")).toBeNull();
  });
});

describe("pruneUsageHistory", () => {
  it("deletes rows older than the retention window", async () => {
    mocks.db.run.mockClear();
    const now = Date.parse("2026-06-01T00:00:00Z");
    const n = await usage.pruneUsageHistory({ force: true, now });
    expect(n).toBe(7);
    const call = mocks.db.run.mock.calls.find(([sql]) => /DELETE FROM usageHistory/.test(sql));
    expect(call[1][0]).toBe(new Date(now - 30 * 86400000).toISOString());
  });

  it("is throttled to once per interval", async () => {
    const now = Date.now();
    await usage.pruneUsageHistory({ force: true, now });
    expect(await usage.pruneUsageHistory({ now: now + 1000 })).toBe(0);
  });
});
