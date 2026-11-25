export const BUDGET_PERIODS = Object.freeze(["day", "month"]);

export function validateKeyBudgetInput(input) {
  if (input === null) return { ok: true, value: null };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "budget must be an object { period, maxTokens?, maxCost? } or null" };
  }
  const extra = Object.keys(input).filter((k) => k !== "period" && k !== "maxTokens" && k !== "maxCost");
  if (extra.length) return { ok: false, error: `budget: unexpected field(s) ${extra.join(", ")}` };
  if (!BUDGET_PERIODS.includes(input.period)) {
    return { ok: false, error: `budget.period must be one of ${BUDGET_PERIODS.join(", ")}` };
  }
  const value = { period: input.period };
  if (input.maxTokens !== undefined && input.maxTokens !== null) {
    if (!Number.isInteger(input.maxTokens) || input.maxTokens <= 0) {
      return { ok: false, error: "budget.maxTokens must be a positive integer" };
    }
    value.maxTokens = input.maxTokens;
  }
  if (input.maxCost !== undefined && input.maxCost !== null) {
    if (typeof input.maxCost !== "number" || !Number.isFinite(input.maxCost) || input.maxCost <= 0) {
      return { ok: false, error: "budget.maxCost must be a positive number" };
    }
    value.maxCost = input.maxCost;
  }
  if (value.maxTokens === undefined && value.maxCost === undefined) {
    return { ok: false, error: "budget needs maxTokens and/or maxCost" };
  }
  return { ok: true, value };
}

export function storedBudget(period, maxTokens, maxCost) {
  if (period == null) return { budget: null, invalid: false };
  const checked = validateKeyBudgetInput({ period, maxTokens, maxCost });
  return checked.ok ? { budget: checked.value, invalid: false } : { budget: null, invalid: true };
}

export function budgetToColumns(budget) {
  if (!budget) return { budgetPeriod: null, budgetMaxTokens: null, budgetMaxCost: null };
  return {
    budgetPeriod: budget.period,
    budgetMaxTokens: budget.maxTokens ?? null,
    budgetMaxCost: budget.maxCost ?? null,
  };
}
