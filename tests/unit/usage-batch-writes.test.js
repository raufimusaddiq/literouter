import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = {
    transaction: vi.fn((fn) => fn()),
    get: vi.fn((sql) => {
      if (String(sql).includes("totalRequestsLifetime")) return { value: "0" };
      if (String(sql).includes("usageRollupKey")) return { id: 1 };
      return null;
    }),
    run: vi.fn(() => ({ changes: 1 })),
    all: vi.fn(() => []),
  };
  return {
    db,
    getAdapter: vi.fn(async () => db),
    getAdapterSync: vi.fn(() => db),
    getPricingForModel: vi.fn(async () => null),
  };
});

vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: mocks.getAdapter,
  getAdapterSync: mocks.getAdapterSync,
}));

vi.mock("@/lib/db/repos/pricingRepo.js", () => ({
  getPricingForModel: mocks.getPricingForModel,
}));

const {
  saveRequestUsage,
  flushUsageQueue,
  flushUsageDailySync,
  _resetUsageDailyCache,
  __usageBuffer__,
} = await import("@/lib/db/repos/usageRepo.js");

beforeEach(async () => {
  await flushUsageQueue();
  _resetUsageDailyCache();
  vi.clearAllMocks();
  mocks.db.transaction.mockImplementation((fn) => fn());
  mocks.db.get.mockImplementation((sql) => {
    if (String(sql).includes("totalRequestsLifetime")) return { value: "0" };
    if (String(sql).includes("usageRollupKey")) return { id: 1 };
    return null;
  });
  mocks.db.run.mockReturnValue({ changes: 1 });
});

describe("Usage batch persistence", () => {
  it("persists many completions in one SQLite transaction", async () => {
    const base = Date.now();
    await Promise.all(Array.from({ length: 20 }, (_, index) => saveRequestUsage({
      timestamp: new Date(base + index).toISOString(),
      provider: "codex",
      model: "gpt-test",
      connectionId: "account-a",
      endpoint: "/v1/responses",
      tokens: { prompt_tokens: 100 + index, completion_tokens: 10 },
    })));

    expect(__usageBuffer__.size()).toBe(0);
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);

    const historyInserts = mocks.db.run.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO usageHistory")
    );
    expect(historyInserts).toHaveLength(20);

    const dailyWrites = () => mocks.db.run.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO usageDaily")
    );
    expect(dailyWrites()).toHaveLength(0);
    flushUsageDailySync(mocks.db);
    expect(dailyWrites()).toHaveLength(1);
    expect(JSON.parse(dailyWrites()[0][1][1]).requests).toBe(20);

    const lifetimeWrites = mocks.db.run.mock.calls.filter(([sql]) =>
      String(sql).includes("totalRequestsLifetime")
    );
    expect(lifetimeWrites).toHaveLength(1);
  });

  it("flushes the in-memory daily aggregate on shutdown drain", async () => {
    await saveRequestUsage({
      timestamp: new Date().toISOString(), provider: "codex", model: "m", connectionId: "c",
      tokens: { prompt_tokens: 5, completion_tokens: 1 },
    });
    await flushUsageQueue();
    const dailyWrites = () => mocks.db.run.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO usageDaily"));
    expect(dailyWrites()).toHaveLength(0);
    globalThis.__liteRouterUsageDrainSync();
    expect(dailyWrites()).toHaveLength(1);
    globalThis.__liteRouterUsageDrainSync();
    expect(dailyWrites()).toHaveLength(1);
  });

  it("does not fold a rolled-back batch into the daily aggregate", async () => {
    mocks.db.transaction.mockImplementationOnce(() => { throw new Error("boom"); });
    const p = saveRequestUsage({
      timestamp: new Date().toISOString(), provider: "codex", model: "m", connectionId: "c",
      tokens: { prompt_tokens: 5, completion_tokens: 1 },
    });
    await flushUsageQueue().catch(() => {});
    await p.catch(() => {});
    flushUsageDailySync(mocks.db);
    const writes = mocks.db.run.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO usageDaily"));
    for (const w of writes) expect(JSON.parse(w[1][1]).requests).toBeLessThanOrEqual(1);
  });
});
