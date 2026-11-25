import { describe, it, expect, beforeEach } from "bun:test";
import { useTempDataDir } from "#test/tempDataDir";
import { validateKeyBudgetInput } from "@/shared/utils/keyBudget.js";

process.env.USAGE_FLUSH_INTERVAL_MS = "60000";

useTempDataDir("9router-key-budget-");

const load = async () => {
  const repo = await import("@/lib/db/repos/keyBudgetRepo.js");
  const keys = await import("@/lib/db/repos/apiKeysRepo.js");
  const usage = await import("@/lib/db/repos/usageRepo.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  return { ...repo, ...keys, ...usage, db: await getAdapter() };
};

const settleNote = () => new Promise((resolve) => setTimeout(resolve, 25));

const usageEntry = (apiKey, timestamp = new Date().toISOString()) => ({
  provider: "openai",
  model: "model-a",
  tokens: { prompt_tokens: 10, completion_tokens: 5 },
  apiKey,
  endpoint: "/v1/chat/completions",
  timestamp,
});

describe("budget input validation", () => {
  it.each([
    [{ period: "week", maxTokens: 10 }, "period"],
    [{ period: "", maxTokens: 10 }, "period"],
    [{ period: "day" }, "maxTokens and/or maxCost"],
    [{ period: "day", maxTokens: 0 }, "positive integer"],
    [{ period: "day", maxTokens: -5 }, "positive integer"],
    [{ period: "day", maxTokens: 1.5 }, "positive integer"],
    [{ period: "day", maxTokens: "100" }, "positive integer"],
    [{ period: "day", maxCost: 0 }, "positive number"],
    [{ period: "day", maxCost: -1 }, "positive number"],
    [{ period: "day", maxCost: Number.POSITIVE_INFINITY }, "positive number"],
    [{ period: "day", maxTokens: 10, extra: true }, "unexpected field"],
    [[], "must be an object"],
  ])("rejects %p", (input, expected) => {
    const checked = validateKeyBudgetInput(input);
    expect(checked.ok).toBe(false);
    expect(checked.error).toContain(expected);
  });

  it.each([
    [{ period: "day", maxTokens: 1000 }, { period: "day", maxTokens: 1000 }],
    [{ period: "month", maxCost: 2.5 }, { period: "month", maxCost: 2.5 }],
    [{ period: "day", maxTokens: 10, maxCost: 1 }, { period: "day", maxTokens: 10, maxCost: 1 }],
    [null, null],
  ])("accepts %p", (input, expected) => {
    expect(validateKeyBudgetInput(input)).toEqual({ ok: true, value: expected });
  });
});

describe("budget storage", () => {
  beforeEach(async () => {
    const { _resetBudgetPending } = await import("@/lib/db/repos/keyBudgetRepo.js");
    _resetBudgetPending();
  });

  it("keeps existing keys unlimited when the budget migration runs", async () => {
    const m006 = (await import("@/lib/db/migrations/006-key-budgets.js")).default;
    const { createApiKey, getApiKeyById, db } = await load();
    const created = await createApiKey("legacy", "machine-1");
    m006.up(db);
    const key = await getApiKeyById(created.id);
    expect(key.budget).toBeNull();
    expect(key.budgetInvalid).toBe(false);
  });

  it("stores a budget on the key and reads it back", async () => {
    const { createApiKey, updateApiKey, getApiKeyById } = await load();
    const created = await createApiKey("k", "machine-1");
    expect(created.budget).toBeNull();
    const updated = await updateApiKey(created.id, { budget: { period: "day", maxTokens: 7 } });
    expect(updated.budget).toEqual({ period: "day", maxTokens: 7 });
    expect((await getApiKeyById(created.id)).budget).toEqual({ period: "day", maxTokens: 7 });
    expect((await updateApiKey(created.id, { budget: null })).budget).toBeNull();
  });

  it("marks a stored budget that no longer parses as invalid instead of unlimited", async () => {
    const { createApiKey, getApiKeyById, db } = await load();
    const created = await createApiKey("k", "machine-1");
    db.run(`UPDATE apiKeys SET budgetPeriod = 'week', budgetMaxTokens = 5 WHERE id = ?`, [created.id]);
    const key = await getApiKeyById(created.id);
    expect(key.budget).toBeNull();
    expect(key.budgetInvalid).toBe(true);
  });

  it("exports an invalid stored budget so re-importing it is refused", async () => {
    const { createApiKey, db } = await load();
    const { exportDb, importDb } = await import("@/lib/db/index.js");
    const created = await createApiKey("k", "machine-1");
    db.run(`UPDATE apiKeys SET budgetPeriod = 'week', budgetMaxTokens = 5 WHERE id = ?`, [created.id]);
    const dump = await exportDb();
    const key = dump.apiKeys.find((k) => k.id === created.id);
    expect(key.budget).toEqual({ period: "week", maxTokens: 5, maxCost: null });
    await expect(importDb(dump)).rejects.toThrow("budget.period");
  });

  it("keeps an unparseable stored budget when an unrelated field is updated", async () => {
    const { createApiKey, updateApiKey, getApiKeyById, db } = await load();
    const created = await createApiKey("k", "machine-1");
    db.run(`UPDATE apiKeys SET budgetPeriod = 'week', budgetMaxTokens = 5 WHERE id = ?`, [created.id]);
    const updated = await updateApiKey(created.id, { isActive: false });
    expect(updated.budgetInvalid).toBe(true);
    expect((await getApiKeyById(created.id)).budgetInvalid).toBe(true);
    expect((await updateApiKey(created.id, { budget: null })).budgetInvalid).toBe(false);
  });

  it("deletes the key's spend counters with the key", async () => {
    const { createApiKey, deleteApiKey, addBudgetSpend, db } = await load();
    const created = await createApiKey("k", "machine-1");
    addBudgetSpend(db, { budgetKeyId: created.id, budgetTokens: 5, budgetCost: 0.1, timestamp: new Date().toISOString() });
    expect(db.get(`SELECT COUNT(*) AS c FROM apiKeyBudgetSpend WHERE keyId = ?`, [created.id]).c).toBeGreaterThan(0);
    expect(await deleteApiKey(created.id)).toBe(true);
    expect(db.get(`SELECT COUNT(*) AS c FROM apiKeyBudgetSpend WHERE keyId = ?`, [created.id]).c).toBe(0);
  });

  it("adds spend per UTC day window and reports the reset time", async () => {
    const { createApiKey, addBudgetSpend, getBudgetSpend, db } = await load();
    const created = await createApiKey("k", "machine-1");
    const noon = Date.parse("2026-03-05T12:00:00.000Z");
    addBudgetSpend(db, { budgetKeyId: created.id, budgetTokens: 30, budgetCost: 0.25, timestamp: "2026-03-05T12:00:00.000Z" });
    addBudgetSpend(db, { budgetKeyId: created.id, budgetTokens: 12, budgetCost: 0.5, timestamp: "2026-03-05T18:00:00.000Z" });
    expect(await getBudgetSpend(created.id, "day", noon)).toEqual({
      tokens: 42,
      cost: 0.75,
      resetsAt: "2026-03-06T00:00:00.000Z",
    });
  });

  it("starts a fresh window at UTC midnight and UTC month start", async () => {
    const { createApiKey, addBudgetSpend, getBudgetSpend, db } = await load();
    const created = await createApiKey("k", "machine-1");
    addBudgetSpend(db, { budgetKeyId: created.id, budgetTokens: 5, budgetCost: 0, timestamp: "2026-03-05T23:59:59.000Z" });
    addBudgetSpend(db, { budgetKeyId: created.id, budgetTokens: 9, budgetCost: 0, timestamp: "2026-03-31T23:00:00.000Z" });
    const nextDay = Date.parse("2026-03-06T00:00:00.000Z");
    const nextMonth = Date.parse("2026-04-01T00:00:00.000Z");
    expect((await getBudgetSpend(created.id, "day", nextDay)).tokens).toBe(0);
    expect((await getBudgetSpend(created.id, "month", nextMonth)).tokens).toBe(0);
    expect((await getBudgetSpend(created.id, "month", nextMonth)).resetsAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("shows a completed request's spend before the usage row is flushed", async () => {
    const { createApiKey, getBudgetSpend, saveRequestUsage, flushUsageQueue, db } = await load();
    const created = await createApiKey("k", "machine-1");
    const entry = usageEntry(created.key);
    const done = saveRequestUsage(entry);
    await settleNote();
    expect(db.get(`SELECT COUNT(*) AS c FROM apiKeyBudgetSpend`).c).toBe(0);
    expect(db.get(`SELECT COUNT(*) AS c FROM usageHistory`).c).toBe(0);
    expect((await getBudgetSpend(created.id, "day")).tokens).toBe(15);
    await flushUsageQueue();
    await done;
    expect((await getBudgetSpend(created.id, "day")).tokens).toBe(15);
    const rows = db.all(`SELECT window, tokens FROM apiKeyBudgetSpend WHERE keyId = ? ORDER BY window`, [created.id]);
    const dayWindow = entry.timestamp.slice(0, 10);
    const monthWindow = dayWindow.slice(0, 7);
    expect(rows).toEqual([
      { window: monthWindow, tokens: 15 },
      { window: dayWindow, tokens: 15 },
    ]);
  });

  it("prunes day and month windows older than the previous month", async () => {
    const { createApiKey, addBudgetSpend, pruneUsageHistory, db } = await load();
    const created = await createApiKey("k", "machine-1");
    const now = Date.parse("2026-04-15T00:00:00.000Z");
    for (const timestamp of ["2026-01-10T00:00:00.000Z", "2026-02-20T00:00:00.000Z", "2026-03-05T00:00:00.000Z", "2026-04-02T00:00:00.000Z"]) {
      addBudgetSpend(db, { budgetKeyId: created.id, budgetTokens: 1, budgetCost: 0, timestamp });
    }
    await pruneUsageHistory({ force: true, now });
    const windows = db.all(`SELECT window FROM apiKeyBudgetSpend WHERE keyId = ? ORDER BY window`, [created.id]).map((r) => r.window);
    expect(windows).toEqual(["2026-03", "2026-03-05", "2026-04", "2026-04-02"]);
  });

  it("settles the spend of a deduplicated usage entry so it is not counted twice", async () => {
    const { createApiKey, getBudgetSpend, saveRequestUsage, flushUsageQueue, db } = await load();
    const created = await createApiKey("k", "machine-1");
    const entry = usageEntry(created.key);
    const first = saveRequestUsage({ ...entry });
    await settleNote();
    await flushUsageQueue();
    await first;
    const again = saveRequestUsage({ ...entry });
    await settleNote();
    expect((await getBudgetSpend(created.id, "day")).tokens).toBe(30);
    await flushUsageQueue();
    await again;
    expect(db.get(`SELECT COUNT(*) AS c FROM usageHistory`).c).toBe(1);
    expect((await getBudgetSpend(created.id, "day")).tokens).toBe(15);
  });
});
