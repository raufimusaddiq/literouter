import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = {
    transaction: vi.fn((fn) => fn()),
    get: vi.fn((sql) => {
      if (String(sql).includes("totalRequestsLifetime")) return { value: "0" };
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
  __usageBuffer__,
} = await import("@/lib/db/repos/usageRepo.js");

beforeEach(async () => {
  await flushUsageQueue();
  vi.clearAllMocks();
  mocks.db.transaction.mockImplementation((fn) => fn());
  mocks.db.get.mockImplementation((sql) => {
    if (String(sql).includes("totalRequestsLifetime")) return { value: "0" };
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

    expect(__usageBuffer__.size()).toBe(20);

    await flushUsageQueue();

    expect(__usageBuffer__.size()).toBe(0);
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);

    const historyInserts = mocks.db.run.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO usageHistory")
    );
    expect(historyInserts).toHaveLength(20);

    const dailyWrites = mocks.db.run.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO usageDaily")
    );
    expect(dailyWrites).toHaveLength(1);

    const lifetimeWrites = mocks.db.run.mock.calls.filter(([sql]) =>
      String(sql).includes("totalRequestsLifetime")
    );
    expect(lifetimeWrites).toHaveLength(1);
  });
});
