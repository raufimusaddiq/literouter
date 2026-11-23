import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { vi } from "#test/vi";
import { fingerprintKey, isKeyFingerprint } from "../../open-sse/utils/keyFingerprint.js";

const PLAINTEXT = "sk-legacy-machine-aaaaaa-1234abcd";
let tempDir;
const originalDataDir = process.env.DATA_DIR;

function writeLegacyJson(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "db.json"), JSON.stringify({
    settings: { requireLogin: true },
    apiKeys: [{ id: "k1", key: PLAINTEXT, name: "Default Key", machineId: "m", isActive: true }],
  }));
  fs.writeFileSync(path.join(dir, "usage.json"), JSON.stringify({
    history: [{
      timestamp: "2026-09-01T00:00:00.000Z",
      provider: "openai",
      model: "gpt-test",
      apiKey: PLAINTEXT,
      tokens: { prompt_tokens: 3, completion_tokens: 4 },
      status: "ok",
    }],
    dailySummary: {
      "2026-09-01": {
        date: "2026-09-01",
        byApiKey: {
          [`${PLAINTEXT}|gpt-test|openai`]: {
            apiKey: PLAINTEXT, rawModel: "gpt-test", provider: "openai",
            requests: 1, promptTokens: 3, completionTokens: 4, cachedTokens: 0, cost: 0,
          },
        },
      },
    },
  }));
}

async function boot() {
  delete global._dbAdapter;
  vi.resetModules();
  const { getAdapter } = await import("@/lib/db/driver.js");
  return await getAdapter();
}

describe("legacy JSON import fingerprints API keys", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-legacy-import-"));
    process.env.DATA_DIR = tempDir;
  });

  afterEach(() => {
    try { global._dbAdapter?.instance?.close?.(); } catch {}
    delete global._dbAdapter;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("fingerprints usage data but keeps apiKeys.key valid", async () => {
    writeLegacyJson(tempDir);
    const db = await boot();
    const expected = fingerprintKey(PLAINTEXT);

    const keys = db.all(`SELECT key FROM apiKeys`);
    expect(keys).toHaveLength(1);
    expect(keys[0].key).toBe(PLAINTEXT);

    const history = db.all(`SELECT apiKey FROM usageHistory`);
    expect(history).toHaveLength(1);
    expect(history[0].apiKey).toBe(expected);
    expect(isKeyFingerprint(history[0].apiKey)).toBe(true);

    const daily = db.all(`SELECT data FROM usageDaily`);
    expect(JSON.stringify(daily)).not.toContain(PLAINTEXT);
    expect(JSON.stringify(daily)).toContain(expected);
  });

  it("an imported legacy key still validates (apiKeys.key is the live credential)", async () => {
    writeLegacyJson(tempDir);
    await boot();
    const { validateApiKey } = await import("../../src/lib/db/repos/apiKeysRepo.js");
    expect(await validateApiKey(PLAINTEXT)).toBeTruthy();
    expect(await validateApiKey(fingerprintKey(PLAINTEXT))).toBeFalsy();
  });
});
