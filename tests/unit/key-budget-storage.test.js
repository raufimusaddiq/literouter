import { describe, it, expect, beforeEach } from "bun:test";
import { vi } from "#test/vi";
import { useTempDataDir } from "#test/tempDataDir";
import { validateKeyBudgetInput } from "@/shared/utils/keyBudget.js";

const temp = useTempDataDir("9router-key-budget-");

const load = async () => {
  const repo = await import("@/lib/db/repos/keyBudgetRepo.js");
  const keys = await import("@/lib/db/repos/apiKeysRepo.js");
  const usage = await import("@/lib/db/repos/usageRepo.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  return { ...repo, ...keys, ...usage, db: await getAdapter() };
};

describe("budget input validation", () => {
  it.each([
    [{ period: "week", maxTokens: 10 }, "period"],
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
    expect((await getApiKeyById(created.id)).budget).toBeNull();
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

  it("adds spend per UTC day window and reports the reset time", async () => {
    const { createApiKey, addBudgetSpend, getBudgetSpend, db } = await load();
    const created = await createApiKey("k", "machine-1");
    const noon = Date.parse("2026-03-05T12:00:00.000Z");
    addBudgetSpend(db, { budgetKeyId: created.id, budgetPeriod: "day", budgetTokens: 30, budgetCost: 0.25, timestamp: "2026-03-05T12:00:00.000Z" });
    addBudgetSpend(db, { budgetKeyId: created.id, budgetPeriod: "day", budgetTokens: 12, budgetCost: 0.5, timestamp: "2026-03-05T18:00:00.000Z" });
    expect(await getBudgetSpend(created.id, "day", noon)).toEqual({
      tokens: 42,
      cost: 0.75,
      resetsAt: "2026-03-06T00:00:00.000Z",
    });
  });

  it("starts a fresh window at UTC midnight and UTC month start", async () => {
    const { createApiKey, addBudgetSpend, getBudgetSpend, db } = await load();
    const created = await createApiKey("k", "machine-1");
    addBudgetSpend(db, { budgetKeyId: created.id, budgetPeriod: "day", budgetTokens: 5, budgetCost: 0, timestamp: "2026-03-05T23:59:59.000Z" });
    addBudgetSpend(db, { budgetKeyId: created.id, budgetPeriod: "month", budgetTokens: 9, budgetCost: 0, timestamp: "2026-03-31T23:00:00.000Z" });
    const nextDay = Date.parse("2026-03-06T00:00:00.000Z");
    const nextMonth = Date.parse("2026-04-01T00:00:00.000Z");
    expect((await getBudgetSpend(created.id, "day", nextDay)).tokens).toBe(0);
    expect((await getBudgetSpend(created.id, "month", nextMonth)).tokens).toBe(0);
    expect((await getBudgetSpend(created.id, "month", nextMonth)).resetsAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("counts a completed request before the usage flush and does not double count after it", async () => {
    const { createApiKey, getBudgetSpend, saveRequestUsage, flushUsageQueue } = await load();
    const created = await createApiKey("k", "machine-1");
    await flushUsageQueue();
    expect((await getBudgetSpend(created.id, "day")).tokens).toBe(0);
    await saveRequestUsage({
      provider: "openai",
      model: "model-a",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      apiKey: created.key,
      endpoint: "/v1/chat/completions",
    });
    expect((await getBudgetSpend(created.id, "day")).tokens).toBe(15);
    await flushUsageQueue();
    expect((await getBudgetSpend(created.id, "day")).tokens).toBe(15);
  });
});
