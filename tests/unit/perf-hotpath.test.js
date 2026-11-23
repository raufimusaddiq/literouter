import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { vi } from "#test/vi";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const state = vi.hoisted(() => ({ db: null }));
vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: vi.fn(async () => state.db),
  getAdapterSync: vi.fn(() => state.db),
}));
vi.mock("@/lib/db/repos/connectionsRepo.js", () => ({ getProviderConnections: vi.fn(async () => []) }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeys: vi.fn(async () => []) }));
vi.mock("@/lib/db/repos/nodesRepo.js", () => ({ getProviderNodes: vi.fn(async () => []) }));

const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
const usage = await import("@/lib/db/repos/usageRepo.js");
const { backfillUsageRollup, ensureRollupTables } = await import("@/lib/db/usageRollup.js");

let tmp;
beforeEach(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "perf-hotpath-"));
  state.db = await createSqlJsAdapter(path.join(tmp, "t.db"));
  state.db.exec(`CREATE TABLE usageHistory (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, provider TEXT, model TEXT, connectionId TEXT, apiKey TEXT, endpoint TEXT, promptTokens INTEGER DEFAULT 0, completionTokens INTEGER DEFAULT 0, cost REAL DEFAULT 0, status TEXT, tokens TEXT, meta TEXT, latencyMs INTEGER, ttftMs INTEGER, errorText TEXT);
    CREATE TABLE usageDaily (dateKey TEXT PRIMARY KEY, data TEXT);
    CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT);`);
  ensureRollupTables(state.db);
  usage._resetLiveStatsCache();
});
afterEach(() => { vi.restoreAllMocks(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

function jsAggregate(rows) {
  const out = { prompt: 0, completion: 0, cached: 0, cost: 0, byProvider: {}, byModel: {} };
  for (const r of rows) {
    let t = {};
    try { t = JSON.parse(r.tokens) || {}; } catch {}
    const p = t.prompt_tokens || t.input_tokens || r.promptTokens || 0;
    const c = t.completion_tokens || t.output_tokens || r.completionTokens || 0;
    const k = t.cached_tokens || t.cache_read_input_tokens || 0;
    out.prompt += p; out.completion += c; out.cached += k; out.cost += r.cost || 0;
    const bp = (out.byProvider[r.provider] ??= { requests: 0, prompt: 0, completion: 0, cached: 0 });
    bp.requests++; bp.prompt += p; bp.completion += c; bp.cached += k;
    const mk = `${r.model} (${r.provider})`;
    const bm = (out.byModel[mk] ??= { requests: 0, prompt: 0, lastUsed: r.timestamp });
    bm.requests++; bm.prompt += p; if (r.timestamp > bm.lastUsed) bm.lastUsed = r.timestamp;
  }
  return out;
}

describe("getUsageStats 24h aggregates in SQL", () => {
  it("matches the old JS aggregation on a mixed fixture", async () => {
    const now = Date.now();
    const fixture = [
      { provider: "openai", model: "gpt-a", tokens: { prompt_tokens: 10, completion_tokens: 5, cached_tokens: 2 }, cost: 0.1 },
      { provider: "openai", model: "gpt-a", tokens: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 4 }, cost: 0.2 },
      { provider: "claude", model: "sonnet", tokens: {}, promptTokens: 30, completionTokens: 9, cost: 0.3 },
      { provider: "claude", model: "sonnet", tokens: null, promptTokens: 1, completionTokens: 1, cost: null },
      { provider: "openai", model: "gpt-b", tokens: { prompt_tokens: 0, input_tokens: 8 }, promptTokens: 99, cost: 0 },
    ].map((r, i) => ({
      ...r,
      timestamp: new Date(now - (i + 1) * 60000).toISOString(),
      tokens: r.tokens === null ? null : JSON.stringify(r.tokens),
      promptTokens: r.promptTokens || 0, completionTokens: r.completionTokens || 0,
    }));
    fixture.push({ provider: "x", model: "bad", timestamp: new Date(now - 1000).toISOString(), tokens: "{not json", promptTokens: 4, completionTokens: 2, cost: 1 });
    for (const r of fixture) {
      state.db.run(`INSERT INTO usageHistory(timestamp, provider, model, tokens, promptTokens, completionTokens, cost) VALUES(?,?,?,?,?,?,?)`,
        [r.timestamp, r.provider, r.model, r.tokens, r.promptTokens, r.completionTokens, r.cost]);
    }
    state.db.run(`INSERT INTO usageHistory(timestamp, provider, model, tokens) VALUES(?,?,?,?)`,
      [new Date(now - 3 * 86400000).toISOString(), "old", "old", "{}"]);

    backfillUsageRollup(state.db, new Date(now - 3 * 86400000 - 1000).toISOString());
    const ref = jsAggregate(fixture);
    const stats = await usage.getUsageStats("24h");
    expect(stats.totalPromptTokens).toBe(ref.prompt);
    expect(stats.totalCompletionTokens).toBe(ref.completion);
    expect(stats.totalCachedTokens).toBe(ref.cached);
    expect(stats.totalCost).toBeCloseTo(ref.cost, 9);
    expect(stats.totalRequests).toBe(fixture.length);
    for (const [prov, v] of Object.entries(ref.byProvider)) {
      expect(stats.byProvider[prov]).toMatchObject({ requests: v.requests, promptTokens: v.prompt, completionTokens: v.completion, cachedTokens: v.cached });
    }
    for (const [mk, v] of Object.entries(ref.byModel)) {
      expect(stats.byModel[mk].requests).toBe(v.requests);
      expect(stats.byModel[mk].promptTokens).toBe(v.prompt);
      expect(stats.byModel[mk].lastUsed).toBe(v.lastUsed);
    }
    expect(stats.byProvider.old).toBeUndefined();
  });

  it("counts the partial cutoff bucket from raw rows exactly once", async () => {
    const edge = new Date(Date.now() - 24 * 3600000 + 90000).toISOString();
    const before = new Date(Date.now() - 24 * 3600000 - 90000).toISOString();
    for (const ts of [edge, before]) {
      state.db.run(`INSERT INTO usageHistory(timestamp, provider, model, tokens, promptTokens) VALUES(?,?,?,?,?)`, [ts, "p", "m", JSON.stringify({ prompt_tokens: 5, cached_tokens: 2 }), 5]);
    }
    backfillUsageRollup(state.db, new Date(Date.now() - 3 * 86400000).toISOString());
    const stats = await usage.getUsageStats("24h");
    expect(stats.byProvider.p.requests).toBe(1);
    expect(stats.totalPromptTokens).toBe(5);
    expect(stats.totalCachedTokens).toBe(2);
  });

  it("two reads inside the floor run one query set, even after a persisted batch", async () => {
    state.db.run(`INSERT INTO usageHistory(timestamp, provider, model, tokens) VALUES(?,?,?,?)`, [new Date().toISOString(), "p", "m", "{}"]);
    backfillUsageRollup(state.db, new Date(Date.now() - 86400000).toISOString());
    const spy = vi.spyOn(state.db, "all");
    const isAgg = ([sql]) => /FROM usageRollup WHERE bucket/.test(sql);
    await usage.getUsageStats("24h");
    expect(spy.mock.calls.filter(isAgg)).toHaveLength(1);
    await usage.saveRequestUsage({ provider: "p", model: "m", tokens: { prompt_tokens: 1 }, timestamp: new Date().toISOString() });
    await usage.getUsageStats("24h");
    await usage.getUsageStats("24h");
    expect(spy.mock.calls.filter(isAgg)).toHaveLength(1);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 3500 });
    try {
      const stats = await usage.getUsageStats("24h");
      expect(stats.byProvider.p.requests).toBe(2);
    } finally { vi.useRealTimers(); }
    expect(spy.mock.calls.filter(isAgg)).toHaveLength(2);
  });
});

describe("sql.js statement cache", () => {
  it("returns correct rows across repeated cached statements", async () => {
    state.db.run(`INSERT INTO _meta(key, value) VALUES(?, ?)`, ["a", "1"]);
    state.db.run(`INSERT INTO _meta(key, value) VALUES(?, ?)`, ["b", "2"]);
    for (let i = 0; i < 3; i++) {
      expect(state.db.get(`SELECT value FROM _meta WHERE key = ?`, ["a"]).value).toBe("1");
      expect(state.db.get(`SELECT value FROM _meta WHERE key = ?`, ["b"]).value).toBe("2");
      expect(state.db.get(`SELECT value FROM _meta WHERE key = ?`, ["zz"])).toBeUndefined();
      expect(state.db.all(`SELECT key FROM _meta ORDER BY key`)).toHaveLength(2);
    }
  });
});
