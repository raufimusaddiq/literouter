import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { fingerprintKey, redactClientHeaders, redactUpstreamHeaders } from "../../open-sse/utils/keyFingerprint.js";

// Sanitized fixtures only: these are not credentials.
const KEY_A = "sk-fixture-aaaaaa-00000001";
const KEY_B = "sk-fixture-bbbbbb-00000002";
const UPSTREAM = "upstream-fixture-token-0003";

function readTree(dir) {
  let out = "";
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    out += e.isDirectory() ? readTree(p) : fs.readFileSync(p, "utf8");
  }
  return out;
}

describe("fingerprintKey", () => {
  it("is stable, distinguishes clients, and does not contain the key", () => {
    const a = fingerprintKey(KEY_A);
    expect(a).toMatch(/^fp_[0-9a-f]{16}$/);
    expect(fingerprintKey(` ${KEY_A} `)).toBe(a);
    expect(fingerprintKey(KEY_B)).not.toBe(a);
    expect(a).not.toContain("fixture");
    expect(fingerprintKey(a)).toBe(a);
    expect(fingerprintKey("")).toBeNull();
  });

  it("changes with API_KEY_SECRET", () => {
    const before = fingerprintKey(KEY_A);
    process.env.API_KEY_SECRET = "other-fixture-secret";
    try { expect(fingerprintKey(KEY_A)).not.toBe(before); } finally { delete process.env.API_KEY_SECRET; }
  });

  it("redacts client and upstream headers but keeps routing headers", () => {
    const h = redactClientHeaders({ Authorization: `Bearer ${KEY_A}`, "x-api-key": KEY_A, Cookie: "c=1", "user-agent": "ua" });
    expect(JSON.stringify(h)).not.toContain(KEY_A);
    expect(h.Authorization).toBe(fingerprintKey(KEY_A));
    expect(h["x-api-key"]).toBe(fingerprintKey(KEY_A));
    expect(h["user-agent"]).toBe("ua");
    const u = redactUpstreamHeaders({ Authorization: `Bearer ${UPSTREAM}`, "x-goog-api-key": UPSTREAM, "content-type": "application/json" });
    expect(JSON.stringify(u)).not.toContain(UPSTREAM);
    expect(u["content-type"]).toBe("application/json");
  });
});

describe("request log files", () => {
  it("write no key value in any stage and keep route/status", async () => {
    process.env.ENABLE_REQUEST_LOGS = "true";
    const cwd = process.cwd();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-redact-logs-"));
    process.chdir(dir);
    try {
      const { createRequestLogger } = await import("../../open-sse/utils/requestLogger.js?case=redact");
      const log = await createRequestLogger("openai", "openai", "m");
      log.logClientRawRequest("/v1/chat/completions", { model: "m" }, { authorization: `Bearer ${KEY_A}`, "x-api-key": KEY_A });
      log.logRawRequest({ model: "m" }, { authorization: `Bearer ${KEY_A}` });
      log.logTargetRequest("https://up.example/v1", { Authorization: `Bearer ${UPSTREAM}`, "x-api-key": KEY_A }, { model: "m" });
      log.logProviderResponse(502, "Bad Gateway", { "x-request-id": "r1" }, { error: "x" });
      const text = readTree(path.join(dir, "logs"));
      expect(text).not.toContain(KEY_A);
      expect(text).not.toContain(UPSTREAM);
      expect(text).toContain(fingerprintKey(KEY_A));
      expect(text).toContain("/v1/chat/completions");
      expect(text).toContain("https://up.example/v1");
      expect(text).toContain("502");
    } finally {
      process.chdir(cwd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("usage storage", () => {
  afterEach(() => { delete process.env.DATA_DIR; });

  async function open() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-redact-db-"));
    process.env.DATA_DIR = dir;
    vi.resetModules();
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    return { db, adapter };
  }

  it("keeps the key out of usageHistory, usageDaily, history export and stats", async () => {
    const { db, adapter } = await open();
    const ts = new Date().toISOString();
    for (const apiKey of [KEY_A, KEY_A, KEY_B]) {
      await db.saveRequestUsage({ provider: "openai", model: "gpt-4", apiKey, timestamp: ts, endpoint: "/v1/chat/completions", tokens: { prompt_tokens: 1, completion_tokens: 1 } });
    }
    await db.flushUsageQueue?.();
    const rows = adapter.all(`SELECT apiKey FROM usageHistory`);
    const daily = adapter.all(`SELECT data FROM usageDaily`);
    const exported = await db.getUsageHistory();
    const stats = await db.getUsageStats("all");
    for (const blob of [JSON.stringify(rows), JSON.stringify(daily), JSON.stringify(exported), JSON.stringify(stats)]) {
      expect(blob).not.toContain(KEY_A);
      expect(blob).not.toContain(KEY_B);
    }
    const distinct = new Set(rows.map((r) => r.apiKey));
    expect(distinct).toEqual(new Set([fingerprintKey(KEY_A), fingerprintKey(KEY_B)]));
  });

  it("migration 003 rewrites legacy plaintext rows and daily buckets idempotently", async () => {
    const { adapter } = await open();
    const m = (await import("@/lib/db/migrations/003-fingerprint-usage-api-keys.js")).default;
    adapter.run(`INSERT INTO usageHistory(timestamp, provider, model, apiKey, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, 'openai', 'gpt-4', ?, 1, 1, 0, 'ok', '{}', '{}')`, [new Date().toISOString(), KEY_A]);
    const bucket = (k) => ({ requests: 2, promptTokens: 3, completionTokens: 4, cachedTokens: 0, cost: 0, rawModel: "gpt-4", provider: "openai", apiKey: k });
    adapter.run(`INSERT INTO usageDaily(dateKey, data) VALUES('2026-01-01', ?)`, [JSON.stringify({ byApiKey: { [`${KEY_A}|gpt-4|openai`]: bucket(KEY_A), [`${KEY_A} |gpt-4|openai`]: bucket(` ${KEY_A} `) } })]);
    m.up(adapter);
    m.up(adapter);
    const text = JSON.stringify(adapter.all(`SELECT apiKey FROM usageHistory`)) + JSON.stringify(adapter.all(`SELECT data FROM usageDaily WHERE dateKey = '2026-01-01'`));
    expect(text).not.toContain(KEY_A);
    const day = JSON.parse(adapter.get(`SELECT data FROM usageDaily WHERE dateKey = '2026-01-01'`).data);
    const buckets = Object.values(day.byApiKey);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].requests).toBe(4);
  });
});
