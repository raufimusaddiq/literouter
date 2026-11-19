// Hermes review fixes: legacy usage in rollup, allow-set cache invalidation, signature drain on shutdown.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-t38-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch { /* ignore */ }
  delete global._dbAdapter;
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* windows EPERM */ }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("legacy JSON usage import feeds the 24h rollup", () => {
  it("rollup contains legacy rows inside the window after fresh import", async () => {
    const ts = new Date(Date.now() - 3600_000).toISOString();
    fs.writeFileSync(path.join(tempDir, "usage.json"), JSON.stringify({
      history: [
        { timestamp: ts, provider: "openai", model: "gpt-x", tokens: { prompt_tokens: 5, completion_tokens: 7 }, status: "ok" },
        { timestamp: ts, provider: "openai", model: "gpt-x", tokens: { prompt_tokens: 1, completion_tokens: 2 }, status: "ok" },
      ],
    }));
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const r = db.get(`SELECT SUM(n) AS n, SUM(promptTokens) AS p, SUM(completionTokens) AS c FROM usageRollup`);
    expect(r.n).toBe(2);
    expect(r.p).toBe(6);
    expect(r.c).toBe(9);
  });
});

describe("allow-set cache vs combo edits", () => {
  it("a removed combo is denied immediately for a restricted key", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const { createCombo, deleteCombo } = await import("@/lib/db/repos/combosRepo.js");
    const { filterModelsListForKey } = await import("@/sse/services/keyAccess.js");
    const { KEY_ACCESS_COMBO_OWNER } = await import("@/shared/constants/keyAccess.js");
    const combo = await createCombo({ name: "mycombo", models: ["openai/gpt-4o"] });
    const mk = () => ({ keyId: "k1", keyName: "k1", allow: ["mycombo"], _sets: null });
    const list = () => [{ id: "mycombo", owned_by: KEY_ACCESS_COMBO_OWNER }];
    expect(await filterModelsListForKey(mk(), list())).toHaveLength(1);
    await deleteCombo(combo.id);
    expect(await filterModelsListForKey(mk(), list())).toHaveLength(0);
  });
});

describe("thought signature shutdown drain", () => {
  it("drainRuntimeBuffersSync persists pending signatures synchronously", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const store = await import("../../open-sse/services/thoughtSignatureStore.js");
    store.storeGeminiThoughtSignature("call-1", "sig-abc", null, "gemini-2.5-pro");
    const { getAdapterSync } = await import("@/lib/db/driver.js");
    const before = getAdapterSync().all(`SELECT key FROM kv WHERE scope = 'gemini_thought_signatures'`);
    expect(before).toHaveLength(0);
    const { drainRuntimeBuffersSync } = await import("@/lib/db/shutdown.js");
    expect(drainRuntimeBuffersSync()).toBe(true);
    const after = getAdapterSync().all(`SELECT key FROM kv WHERE scope = 'gemini_thought_signatures'`);
    expect(after.map((r) => r.key)).toContain("call-1");
  });
});
