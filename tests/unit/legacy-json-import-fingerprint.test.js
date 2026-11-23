import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "bun:test";
import { useTempDataDir } from "#test/tempDataDir";
import { fingerprintKey, isKeyFingerprint } from "../../open-sse/utils/keyFingerprint.js";

const PLAINTEXT = "sk-legacy-machine-aaaaaa-1234abcd";

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
  const { getAdapter } = await import("@/lib/db/driver.js");
  return await getAdapter();
}

describe("legacy JSON import fingerprints API keys", () => {
  const temp = useTempDataDir("9router-legacy-import-");

  it("fingerprints usage data but keeps apiKeys.key valid", async () => {
    writeLegacyJson(temp.dir);
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
    writeLegacyJson(temp.dir);
    await boot();
    const { validateApiKey } = await import("../../src/lib/db/repos/apiKeysRepo.js");
    expect(await validateApiKey(PLAINTEXT)).toBeTruthy();
    expect(await validateApiKey(fingerprintKey(PLAINTEXT))).toBeFalsy();
  });
});
