import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// lastUsed must be the real ISO timestamp of the latest request, never a local
// date key ("YYYY-MM-DD"), even in the window between local and UTC midnight.
const ORIGINAL_TZ = process.env.TZ;
let tempDir;

const CASES = [
  // [tz, label, instant]
  ["Asia/Jakarta", "just after local midnight (before UTC midnight)", "2026-11-19T17:05:00.000Z"],
  ["Asia/Jakarta", "just before UTC midnight", "2026-11-19T23:55:00.000Z"],
  ["America/Los_Angeles", "just after UTC midnight (local evening)", "2026-11-20T00:05:00.000Z"],
  ["America/Los_Angeles", "just after local midnight", "2026-11-20T08:05:00.000Z"],
];

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-lastused-tz-"));
  process.env.DATA_DIR = tempDir;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.DATA_DIR;
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("usage lastUsed across the local/UTC midnight gap", () => {
  for (const [tz, label, instant] of CASES) {
    it(`${tz}: ${label}`, async () => {
      process.env.TZ = tz;
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(instant));
      vi.resetModules();
      const db = await import("@/lib/db/index.js");
      await db.initDb();

      const apiKey = "sk-machine-tzzzzz-33333333";
      const common = { provider: "openai", model: "gpt-4", connectionId: "c1", endpoint: "/v1/chat", status: "ok" };
      await db.saveRequestUsage({ ...common, apiKey, timestamp: instant, tokens: { prompt_tokens: 1, completion_tokens: 1 } });
      await db.saveRequestUsage({ ...common, timestamp: instant, tokens: { prompt_tokens: 1, completion_tokens: 1 } });

      for (const period of ["24h", "today", "7d", "30d"]) {
        const stats = await db.getUsageStats(period);
        for (const dim of ["byModel", "byAccount", "byApiKey", "byEndpoint"]) {
          const entries = Object.values(stats[dim]);
          expect(entries.length, `${period}/${dim}`).toBeGreaterThan(0);
          for (const e of entries) {
            expect(e.lastUsed, `${period}/${dim}`).toBe(instant);
          }
        }
      }
    });
  }
});

// Legacy usageDaily rows have no lastTs. lastUsed must then fall back to a real
// ISO instant at local end-of-day of the day key (never a bare date, never null),
// and a real lastTs on the same key always wins over the synthetic fallback.
describe("usage lastUsed fallback for legacy day rows", () => {
  const localDate = (iso) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const entry = (extra = {}) => ({
    requests: 1, promptTokens: 1, completionTokens: 1, cachedTokens: 0, cost: 0,
    rawModel: "gpt-4", provider: "openai", connectionId: "c1", endpoint: "/v1/chat", ...extra,
  });
  // The adapter and daily cache are process-global; start each case clean.
  const resetUsage = (adapter) => {
    adapter.run(`DELETE FROM usageDaily`);
    adapter.run(`DELETE FROM usageHistory`);
    try { adapter.run(`DELETE FROM usageRollup`); } catch { /* optional table */ }
    globalThis.__liteRouterUsageDailyState?.days.clear();
  };
  const dayData = (extra) => JSON.stringify({
    requests: 1, promptTokens: 1, completionTokens: 1, cost: 0,
    byProvider: {},
    byModel: { "gpt-4|openai": entry(extra) },
    byAccount: { c1: entry(extra) },
    byApiKey: { k: entry({ apiKey: "sk-machine-legacy-11111111", ...extra }) },
    byEndpoint: { "/v1/chat|gpt-4|openai": entry(extra) },
  });

  for (const tz of ["Asia/Jakarta", "America/Los_Angeles"]) {
    it(`${tz}: legacy day row -> local end-of-day ISO`, async () => {
      process.env.TZ = tz;
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-20T12:00:00.000Z"));
      vi.resetModules();
      const db = await import("@/lib/db/index.js");
      await db.initDb();
      const { getAdapter } = await import("@/lib/db/driver.js");
      const adapter = await getAdapter();
      resetUsage(adapter);
      adapter.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)`, ["2026-11-15", dayData()]);

      const stats = await db.getUsageStats("30d");
      for (const dim of ["byModel", "byAccount", "byApiKey", "byEndpoint"]) {
        const entries = Object.values(stats[dim]);
        expect(entries.length, dim).toBeGreaterThan(0);
        for (const e of entries) {
          expect(e.lastUsed, dim).toMatch(/T.*Z$/);
          expect(localDate(e.lastUsed), dim).toBe("2026-11-15");
        }
      }
    });

    it(`${tz}: real lastTs on the same key wins over the synthetic fallback`, async () => {
      process.env.TZ = tz;
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-20T12:00:00.000Z"));
      vi.resetModules();
      const db = await import("@/lib/db/index.js");
      await db.initDb();
      const { getAdapter } = await import("@/lib/db/driver.js");
      const adapter = await getAdapter();
      resetUsage(adapter);
      const real = new Date(2026, 10, 15, 3, 0, 0).toISOString(); // early in the day
      adapter.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)`, ["2026-11-15", dayData({ lastTs: real })]);
      adapter.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)`, ["2026-11-16", dayData()]);

      const stats = await db.getUsageStats("30d");
      for (const dim of ["byModel", "byAccount", "byApiKey", "byEndpoint"]) {
        for (const e of Object.values(stats[dim])) expect(e.lastUsed, dim).toBe(real);
      }
    });
  }
});
