import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Database } from "bun:sqlite";
import { TABLES, buildCreateTableSql } from "../../src/lib/db/schema.js";
import { fingerprintKey } from "../../open-sse/utils/keyFingerprint.js";

const dataDir = process.argv[2];
if (!dataDir) {
  console.error("usage: bun scripts/dev/seed-preview.mjs <DATA_DIR>");
  process.exit(1);
}
fs.mkdirSync(path.join(dataDir, "db"), { recursive: true });
const dbFile = path.join(dataDir, "db", "data.sqlite");
if (fs.existsSync(dbFile)) fs.rmSync(dbFile);
const db = new Database(dbFile);
db.exec("PRAGMA journal_mode = WAL;");
for (const [name, def] of Object.entries(TABLES)) {
  db.exec(buildCreateTableSql(name, def));
  for (const idx of def.indexes || []) db.exec(idx);
}

let seed = 20260101;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const uuid = () => crypto.randomUUID();

const now = Date.now();
const iso = (t) => new Date(t).toISOString();
const future = (ms) => iso(now + ms);

const NODE_PROVIDER = "openai-compatible-chat-6d0ab93c-cc80-4278-b1dc-f2da26f80fc6";
const connections = [
  { provider: "openai", name: "OpenAI · prod", testStatus: "success" },
  { provider: "anthropic", name: "Anthropic · main", testStatus: "success" },
  { provider: "gemini", name: "Gemini · shared", testStatus: "unavailable", extra: { [`modelLock_gemini-2.5-pro`]: future(14 * 60000) } },
  { provider: "groq", name: "Groq · fast", testStatus: "success" },
  { provider: "openrouter", name: "OpenRouter · fallback", testStatus: undefined },
  { provider: "deepseek", name: "DeepSeek · batch", testStatus: "success", isActive: false },
  { provider: "mistral", name: "raufimusaddiq@gmail.com", email: "raufimusaddiq@gmail.com", testStatus: "success" },
  { provider: NODE_PROVIDER, name: "Sumopod", testStatus: "success" },
].map((c, i) => ({ ...c, id: uuid(), priority: i + 1 }));

db.prepare(`INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?,?,?,?,?,?)`).run(
  NODE_PROVIDER, "openai-compatible", "Sumopod",
  JSON.stringify({ prefix: "sumopod", apiType: "chat", baseUrl: "https://ai.sumopod.example/v1" }), iso(now - 20 * 86400000), iso(now),
);

const insConn = db.prepare(
  `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)`,
);
for (const c of connections) {
  const data = { apiKey: `sk-preview-${c.provider}`, ...(c.testStatus ? { testStatus: c.testStatus } : {}), ...(c.extra || {}) };
  insConn.run(c.id, c.provider, "apikey", c.name, c.email || null, c.priority, c.isActive === false ? 0 : 1, JSON.stringify(data), iso(now - 20 * 86400000), iso(now));
}

const HOUR = 3600000;
const apiKeys = [
  { name: "Production", lastUsedAgo: 2 * 60000, req24h: 1284, ageDays: 40 },
  { name: "Cursor (laptop)", lastUsedAgo: 3 * HOUR, req24h: 312, ageDays: 22 },
  { name: "CI pipeline", lastUsedAgo: 20 * HOUR, req24h: 47, ageDays: 15, restricted: ["openai/gpt-4o-mini", "groq/llama-3.3-70b-versatile"] },
  { name: "Staging", lastUsedAgo: 5 * 86400000, req24h: 0, ageDays: 12 },
  { name: "Old script", lastUsedAgo: 31 * 86400000, req24h: 0, ageDays: 90, paused: true },
  { name: "New teammate", lastUsedAgo: null, req24h: 0, ageDays: 1 },
].map((k) => ({ ...k, id: uuid(), key: `sk-${crypto.randomBytes(12).toString("hex")}` }));
const insKey = db.prepare(
  `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES(?,?,?,?,?,?,?,?)`,
);
for (const k of apiKeys) {
  insKey.run(k.id, k.key, k.name, "preview", k.paused ? 0 : 1, iso(now - k.ageDays * 86400000),
    k.restricted ? 1 : 0, JSON.stringify(k.restricted || []));
}

const models = [
  { provider: "openai", model: "gpt-4o", inp: [400, 3500], out: [80, 900], rate: [2.5, 10] },
  { provider: "openai", model: "gpt-4o-mini", inp: [200, 2000], out: [50, 500], rate: [0.15, 0.6] },
  { provider: "anthropic", model: "claude-sonnet-4-5", inp: [600, 6000], out: [100, 1500], rate: [3, 15] },
  { provider: "gemini", model: "gemini-2.5-pro", inp: [500, 4000], out: [100, 1200], rate: [1.25, 10] },
  { provider: "groq", model: "llama-3.3-70b-versatile", inp: [150, 1500], out: [40, 600], rate: [0.59, 0.79] },
  { provider: "mistral", model: "mistral-large-latest", inp: [300, 2500], out: [60, 700], rate: [2, 6] },
  { provider: NODE_PROVIDER, model: "sumo-chat", inp: [200, 2000], out: [50, 600], rate: [0.5, 1.5] },
  { provider: "openrouter", model: "mistral-large", inp: [300, 2500], out: [60, 700], rate: [2, 6] },
];
const connByProvider = Object.fromEntries(connections.map((c) => [c.provider, c.id]));
const between = ([a, b]) => Math.round(a + rand() * (b - a));
const dateKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const rows = [];
const TARGET = 2600;
while (rows.length < TARGET) {
  const ageDays = Math.pow(rand(), 1.35) * 7;
  const t = now - ageDays * 86400000;
  const hour = new Date(t).getHours();
  if (rand() > (hour >= 8 && hour <= 20 ? 1 : 0.35)) continue;
  const m = pick(models);
  const prompt = between(m.inp);
  const completion = between(m.out);
  const failed = rand() < 0.04;
  rows.push({
    t, m, prompt, completion, failed,
    cost: failed ? 0 : (prompt * m.rate[0] + completion * m.rate[1]) / 1e6,
  });
}
rows.sort((a, b) => a.t - b.t);

const insUsage = db.prepare(
  `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
);
const days = {};
const add = (target, key, v, meta = {}) => {
  const e = (target[key] ||= { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, ...meta });
  e.requests += 1; e.promptTokens += v.prompt; e.completionTokens += v.completion; e.cost += v.cost;
};
db.exec("BEGIN");
for (const r of rows) {
  const { m } = r;
  const cid = connByProvider[m.provider];
  insUsage.run(
    iso(r.t), m.provider, m.model, cid, null, "/v1/chat/completions", r.prompt, r.completion, r.cost,
    r.failed ? "error" : "ok", JSON.stringify({ prompt_tokens: r.prompt, completion_tokens: r.completion }),
  );
  const day = (days[dateKey(r.t)] ||= { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {} });
  day.requests += 1; day.promptTokens += r.prompt; day.completionTokens += r.completion; day.cost += r.cost;
  const v = { prompt: r.prompt, completion: r.completion, cost: r.cost };
  add(day.byProvider, m.provider, v);
  add(day.byModel, `${m.model}|${m.provider}`, v, { rawModel: m.model, provider: m.provider });
  add(day.byAccount, cid, v, { rawModel: m.model, provider: m.provider });
  add(day.byApiKey, `local-no-key|${m.model}|${m.provider}`, v, { rawModel: m.model, provider: m.provider, apiKey: null });
  add(day.byEndpoint, `/v1/chat/completions|${m.model}|${m.provider}`, v, { endpoint: "/v1/chat/completions", rawModel: m.model, provider: m.provider });
}
const insDay = db.prepare(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)`);
for (const [k, d] of Object.entries(days)) insDay.run(k, JSON.stringify(d));
for (const k of apiKeys) {
  if (k.lastUsedAgo == null) continue;
  const fp = fingerprintKey(k.key);
  const n = Math.max(k.req24h, 1);
  for (let i = 0; i < n; i++) {
    const t = k.req24h > 0 ? now - k.lastUsedAgo - (i / n) * (24 * HOUR - k.lastUsedAgo) : now - k.lastUsedAgo - i * 60000;
    const m = models[i % models.length];
    insUsage.run(iso(t), m.provider, m.model, connByProvider[m.provider], fp, "/v1/chat/completions", 300, 120, 0.001, "ok", "{}");
  }
}
db.exec("COMMIT");
db.close();

console.log(`Seeded ${dbFile}: ${connections.length} connections, ${rows.length} usage rows over ${Object.keys(days).length} days, ${apiKeys.length} API keys.`);
