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
