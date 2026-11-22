import { describe, expect, it } from "bun:test";
import { vi } from "#test/vi";
import { DatabaseSync } from "node:sqlite";

// Seeded-fixture benchmark for the 24h stats query. Opt-in: BENCH=1 npx vitest run unit/perf-rollup-bench
const state = vi.hoisted(() => ({ db: null }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: vi.fn(async () => state.db), getAdapterSync: vi.fn(() => state.db) }));
vi.mock("@/lib/db/repos/connectionsRepo.js", () => ({ getProviderConnections: vi.fn(async () => []) }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeys: vi.fn(async () => []) }));
vi.mock("@/lib/db/repos/nodesRepo.js", () => ({ getProviderNodes: vi.fn(async () => []) }));
const usage = await import("@/lib/db/repos/usageRepo.js");
const { backfillUsageRollup, ensureRollupTables } = await import("@/lib/db/usageRollup.js");

const N = Number(process.env.BENCH_ROWS || 500000);
describe.skipIf(!process.env.BENCH)("24h stats @ rows", () => {
  it("is fast", async () => {
    const raw = new DatabaseSync(":memory:");
    raw.exec(`CREATE TABLE usageHistory (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, provider TEXT, model TEXT, connectionId TEXT, apiKey TEXT, endpoint TEXT, promptTokens INTEGER DEFAULT 0, completionTokens INTEGER DEFAULT 0, cost REAL DEFAULT 0, status TEXT, tokens TEXT, meta TEXT, latencyMs INTEGER, ttftMs INTEGER, errorText TEXT);
      CREATE INDEX idx_uh_ts ON usageHistory(timestamp DESC); CREATE TABLE usageDaily (dateKey TEXT PRIMARY KEY, data TEXT); CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT);`);
    
    state.db = {
      all: (s, p = []) => { const t0 = performance.now(); const r = raw.prepare(s).all(...p); if (process.env.BENCH_SQL) process.stderr.write(`  sql ${(performance.now() - t0).toFixed(1)}ms rows=${r.length} ${s.replace(/\s+/g, ' ').slice(0, 60)}
`); return r; }, get: (s, p = []) => raw.prepare(s).get(...p),
      run: (s, p = []) => raw.prepare(s).run(...p), exec: (s) => raw.exec(s), transaction: (f) => f(),
    };
    const ins = raw.prepare(`INSERT INTO usageHistory(timestamp,provider,model,connectionId,apiKey,endpoint,promptTokens,completionTokens,cost,tokens) VALUES(?,?,?,?,?,?,?,?,?,?)`);
    const now = Date.now();
    raw.exec("BEGIN");
    for (let i = 0; i < N; i++) {
      const ts = new Date(now - (i / N) * 86400000 + 60000).toISOString();
      ins.run(ts, `prov${i % 8}`, `model${i % 40}`, `conn${i % 24}`, `fp${i % 5}`, "/v1/chat/completions", 100, 50, 0.001,
        JSON.stringify({ prompt_tokens: 100, completion_tokens: 50, cached_tokens: 10 }));
    }
    raw.exec("COMMIT");
    let t = performance.now();
    backfillUsageRollup(state.db, new Date(now - 3 * 86400000).toISOString());
    const backfillMs = performance.now() - t;
    const times = [];
    for (let i = 0; i < 5; i++) {
      usage._resetLiveStatsCache();
      t = performance.now();
      const s = await usage.getUsageStats("24h");
      times.push(performance.now() - t);
      expect(s.totalRequests).toBeGreaterThan(N * 0.99);
    }
    process.stderr.write(`BENCH rows=${N} backfill=${backfillMs.toFixed(0)}ms stats(24h, cold cache) ms=${times.map((x) => x.toFixed(1)).join(",")}
`);
  }, 300000);
});
