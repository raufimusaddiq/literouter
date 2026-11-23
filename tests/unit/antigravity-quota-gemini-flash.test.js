import { describe, expect, it, beforeEach } from "bun:test";
import { vi } from "#test/vi";

const state = { models: {} };

const proxyAwareFetch = vi.fn(async (url) => ({
  ok: true,
  status: 200,
  json: async () => url.includes(":loadCodeAssist")
    ? { cloudaicompanionProject: "project-1", currentTier: { name: "Pro" }, paidTier: { id: "g1-pro-tier", name: "Google AI Pro" } }
    : { models: state.models },
  text: async () => "{}",
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

const TIERS = ["high", "medium", "low"];
const TIER_LABEL = { high: "High", medium: "Medium", low: "Low" };
const INTERNAL = { "internal-model": { displayName: "Internal", isInternal: true, quotaInfo: { remainingFraction: 0.5 } } };

const VERSIONS = [
  { version: "3.6", reset: "2026-07-25T12:00:00Z", fractions: [0.8, 0.5, 0.2], used: [200, 500, 800], remaining: [80, 50, 20] },
  { version: "3.7", reset: "2026-08-25T12:00:00Z", fractions: [0.85, 0.6, 0.35], used: [150, 400, 650], remaining: [85, 60, 35] },
  { version: "3.8", reset: "2026-08-25T12:00:00Z", fractions: [0.85, 0.6, 0.35], used: [150, 400, 650], remaining: [85, 60, 35] },
];

function flashModels({ version, reset, fractions }, extra = {}) {
  const models = {};
  TIERS.forEach((tier, i) => {
    models[`gemini-${version}-flash-${tier}`] = {
      displayName: `Gemini ${version} Flash (${TIER_LABEL[tier]})`,
      quotaInfo: { remainingFraction: fractions[i], resetTime: reset },
    };
  });
  return { ...models, ...extra, ...INTERNAL };
}

describe.each(VERSIONS)("Antigravity quota tracker: Gemini $version Flash usage bars", (row) => {
  const { version } = row;
  beforeEach(() => {
    proxyAwareFetch.mockClear();
    state.models = flashModels(row);
  });

  it(`returns Gemini ${version} Flash tier quotas so the dashboard can render usage bars`, async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    const usage = await getAntigravityUsage("access-token", {});

    expect(usage.quotas[`gemini-${version}-flash-high`]).toMatchObject({
      used: row.used[0],
      total: 1000,
      remainingPercentage: row.remaining[0],
      displayName: `Gemini ${version} Flash (High)`,
    });
    expect(usage.quotas[`gemini-${version}-flash-medium`]).toMatchObject({
      used: row.used[1],
      total: 1000,
      remainingPercentage: row.remaining[1],
    });
    expect(usage.quotas[`gemini-${version}-flash-low`]).toMatchObject({
      used: row.used[2],
      total: 1000,
      remainingPercentage: row.remaining[2],
    });
  });
});

describe("Antigravity quota tracker: Gemini 3.6 Flash model filtering", () => {
  beforeEach(() => {
    proxyAwareFetch.mockClear();
    state.models = flashModels(VERSIONS[0], {
      "gemini-3.5-flash-low": {
        displayName: "Gemini 3.5 Flash (Medium)",
        quotaInfo: { remainingFraction: 0.9, resetTime: "2026-07-25T12:00:00Z" },
      },
    });
  });

  it("still filters out internal and non-important models", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    const usage = await getAntigravityUsage("access-token", {});

    expect(usage.quotas).not.toHaveProperty("internal-model");
    expect(Object.keys(usage.quotas)).toEqual([
      "gemini-3.6-flash-high",
      "gemini-3.6-flash-medium",
      "gemini-3.6-flash-low",
      "gemini-3.5-flash-low",
    ]);
  });
});
