import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
let db;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-api-key-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterEach(() => {
  delete process.env.DATA_DIR;
});

describe("Usage stats API key attribution", () => {
  it("keeps API keys separate without exposing credentials across live and daily periods", async () => {
    const apiKeyA = "sk-machine-aaaaaa-11111111";
    const apiKeyB = "sk-machine-bbbbbb-22222222";
    const timestamp = new Date().toISOString();

    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      connectionId: "c1",
      apiKey: apiKeyA,
      timestamp,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      endpoint: "/v1/chat",
      status: "ok",
    });

    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      connectionId: "c1",
      apiKey: apiKeyB,
      timestamp,
      tokens: { prompt_tokens: 20, completion_tokens: 10 },
      endpoint: "/v1/chat",
      status: "ok",
    });

    // The DB adapter is process-global; seed once rather than resetting modules
    // between periods (which does not replace its open database).
    for (const period of ["24h", "today", "7d", "30d"]) {
      const stats = await db.getUsageStats(period);
      const apiKeyEntries = Object.values(stats.byApiKey);

      expect(apiKeyEntries).toHaveLength(2);
      expect(apiKeyEntries.map((entry) => entry.lastUsed)).toEqual([timestamp, timestamp]);
      expect(JSON.stringify(stats)).not.toContain(apiKeyA);
      expect(JSON.stringify(stats)).not.toContain(apiKeyB);
      expect(Object.keys(stats.byApiKey).sort()).toEqual([
        "sk-machi***1111|gpt-4|openai",
        "sk-machi***2222|gpt-4|openai",
      ]);

      expect(
        apiKeyEntries
          .map((entry) => entry.promptTokens)
          .sort((a, b) => a - b)
      ).toEqual([10, 20]);
    }
  });
});
