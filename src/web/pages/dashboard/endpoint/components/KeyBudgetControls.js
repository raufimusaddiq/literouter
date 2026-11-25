"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Input, Select, Toggle } from "@/shared/components";

const PERIODS = [
  { value: "day", label: "Daily (UTC)" },
  { value: "month", label: "Monthly (UTC)" },
];

const num = (v) => Number(v || 0).toLocaleString();
const usd = (v) => `$${Number(v || 0).toFixed(2)}`;

function limitLine(budget, usage) {
  if (!usage) return null;
  const parts = [];
  if (budget.maxTokens) parts.push(`${num(usage.tokens)} / ${num(budget.maxTokens)} tokens`);
  if (budget.maxCost) parts.push(`${usd(usage.cost)} / ${usd(budget.maxCost)}`);
  return parts.join(" · ");
}

export default function KeyBudgetControls({ apiKey, onChange }) {
  const budget = apiKey.budget || null;
  const [enabled, setEnabled] = useState(Boolean(budget));
  const [period, setPeriod] = useState(budget?.period || "day");
  const [maxTokens, setMaxTokens] = useState(budget?.maxTokens ? String(budget.maxTokens) : "");
  const [maxCost, setMaxCost] = useState(budget?.maxCost ? String(budget.maxCost) : "");
  const [error, setError] = useState("");

  const save = async (next) => {
    setError("");
    const message = await onChange(next);
    if (message) setError(message);
  };

  const apply = () => {
    const next = { period };
    if (maxTokens.trim()) next.maxTokens = Number(maxTokens);
    if (maxCost.trim()) next.maxCost = Number(maxCost);
    if (next.maxTokens === undefined && next.maxCost === undefined) {
      setError("Set a token limit, a cost limit, or both.");
      return;
    }
    save(next);
  };

  const clear = () => {
    setMaxTokens("");
    setMaxCost("");
    save(null);
  };

  return (
    <div className="mt-2 border-t border-line pt-2" data-testid="key-budget">
      <Toggle
        size="sm"
        checked={enabled}
        label="Usage budget"
        onChange={(checked) => {
          setEnabled(checked);
          if (!checked) clear();
        }}
      />
      {budget && (
        <p className="mt-1 text-[12.5px] text-muted">
          {limitLine(budget, apiKey.budgetUsage)}
          {apiKey.budgetUsage?.resetsAt && (
            <span className="text-faint"> · resets {new Date(apiKey.budgetUsage.resetsAt).toLocaleString()}</span>
          )}
        </p>
      )}
      {enabled && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Select
            label="Window"
            className="w-40"
            options={PERIODS}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
          <Input
            label="Max tokens"
            className="w-36"
            type="number"
            min="1"
            step="1"
            placeholder="unlimited"
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
          />
          <Input
            label="Max cost (USD)"
            className="w-36"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="unlimited"
            value={maxCost}
            onChange={(e) => setMaxCost(e.target.value)}
          />
          <button
            type="button"
            onClick={apply}
            className="min-h-9 rounded-md border border-line-strong bg-raise px-3 text-[13px] font-semibold text-ink transition-colors hover:border-ink"
          >
            Save budget
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-[12.5px] text-danger">{error}</p>}
    </div>
  );
}

KeyBudgetControls.propTypes = {
  apiKey: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    budget: PropTypes.shape({
      period: PropTypes.string,
      maxTokens: PropTypes.number,
      maxCost: PropTypes.number,
    }),
    budgetUsage: PropTypes.shape({ tokens: PropTypes.number, cost: PropTypes.number, resetsAt: PropTypes.string }),
  }).isRequired,
  onChange: PropTypes.func.isRequired,
};
