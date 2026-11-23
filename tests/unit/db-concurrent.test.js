import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { useTempDataDir } from "#test/tempDataDir";

useTempDataDir("9router-concurrent-", { scope: "all" });
let db;

beforeAll(async () => {
  process.env.LIVE_STATS_TTL_MS = "0";
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  delete process.env.LIVE_STATS_TTL_MS;
});

describe("DB Concurrency — atomic safety", () => {
  it("100 parallel saveRequestUsage → no count loss", async () => {
    const N = 100;
    const promises = [];
    for (let i = 0; i < N; i++) {
      promises.push(db.saveRequestUsage({
        provider: "openai", model: "gpt-4", connectionId: "c1",
        tokens: { prompt_tokens: 10, completion_tokens: 5 },
        endpoint: "/v1/chat", status: "ok",
        timestamp: new Date(Date.now() + i).toISOString(),
      }));
    }
    await Promise.all(promises);

    const stats = await db.getUsageStats("24h");
    expect(stats.totalRequests).toBe(N);
    expect(stats.byProvider.openai.requests).toBe(N);
    expect(stats.byProvider.openai.promptTokens).toBe(N * 10);

    const hist = (await (await import("@/lib/db/driver.js")).getAdapter()).all(`SELECT id FROM usageHistory WHERE provider = ?`, ["openai"]);
    expect(hist.length).toBe(N);
  });

  it("200 parallel saveRequestDetail → all flushed", async () => {
    await db.updateSettings({ enableObservability: true, observabilityBatchSize: 10 });

    const N = 200;
    const promises = [];
    for (let i = 0; i < N; i++) {
      promises.push(db.saveRequestDetail({
        id: `det-${i}`, provider: "openai", model: "gpt-4",
        connectionId: "c1", status: "ok",
        tokens: { prompt_tokens: 1 }, request: { i }, response: { ok: true },
      }));
    }
    await Promise.all(promises);

    await db.flushRequestDetails();

    const list = await db.getRequestDetails({ provider: "openai", pageSize: 500 });
    expect(list.pagination.totalItems).toBeGreaterThanOrEqual(N);
  }, 15000);

  it("mixed concurrent: usage + details + connections + aliases", async () => {
    const ops = [];
    for (let i = 0; i < 50; i++) {
      ops.push(db.saveRequestUsage({
        provider: "anthropic", model: `m-${i % 3}`, connectionId: "c2",
        tokens: { prompt_tokens: 20 }, status: "ok",
        timestamp: new Date(Date.now() + i).toISOString(),
      }));
      ops.push(db.setModelAlias(`a-${i}`, `target-${i}`));
      ops.push(db.disableModels("openai", [`d-${i}`]));
    }
    await Promise.all(ops);

    const aliases = await db.getModelAliases();
    expect(Object.keys(aliases).filter((k) => k.startsWith("a-")).length).toBe(50);

    const disabled = await db.getDisabledByProvider("openai");
    expect(disabled.length).toBeGreaterThanOrEqual(50);

    const stats = await db.getUsageStats("24h");
    expect(stats.byProvider.anthropic.requests).toBe(50);
  }, 30000);

  it("updateSettings parallel → no merge loss", async () => {
    const N = 50;
    await db.updateSettings({ counter: 0 });
    const promises = [];
    for (let i = 0; i < N; i++) {
      promises.push(db.updateSettings({ [`field${i}`]: `v${i}` }));
    }
    await Promise.all(promises);
    const s = await db.getSettings();
    for (let i = 0; i < N; i++) {
      expect(s[`field${i}`]).toBe(`v${i}`);
    }
  });

  it("OAuth refresh race: parallel updateProviderConnection on same id", async () => {
    const conn = await db.createProviderConnection({
      provider: "oauth-test", authType: "oauth", email: "x@y.com",
      accessToken: "initial", refreshToken: "rt-initial",
    });

    const N = 20;
    const promises = [];
    for (let i = 0; i < N; i++) {
      promises.push(db.updateProviderConnection(conn.id, { [`marker${i}`]: i }));
    }
    await Promise.all(promises);

    const after = await db.getProviderConnectionById(conn.id);
    for (let i = 0; i < N; i++) {
      expect(after[`marker${i}`]).toBe(i);
    }
    expect(after.refreshToken).toBe("rt-initial");
  });

  it("addCustomModel race: parallel duplicate adds → only 1 inserted", async () => {
    const N = 30;
    const promises = [];
    for (let i = 0; i < N; i++) {
      promises.push(db.addCustomModel({ providerAlias: "racep", id: "racemodel", type: "llm", name: "r" }));
    }
    const results = await Promise.all(promises);
    const trueCount = results.filter((r) => r === true).length;
    expect(trueCount).toBe(1);
    const all = await db.getCustomModels();
    expect(all.filter((m) => m.providerAlias === "racep" && m.id === "racemodel").length).toBe(1);
  });

  it("updatePricing race: parallel adds different models → all merged", async () => {
    const N = 30;
    const promises = [];
    for (let i = 0; i < N; i++) {
      promises.push(db.updatePricing({ "race-prov": { [`m${i}`]: { input: i, output: i * 2 } } }));
    }
    await Promise.all(promises);
    const p = await db.getPricing();
    for (let i = 0; i < N; i++) {
      expect(p["race-prov"][`m${i}`]).toEqual({ input: i, output: i * 2 });
    }
  });

  it("daily summary aggregates correctly under parallel writes", async () => {
    const N = 50;
    const promises = [];
    for (let i = 0; i < N; i++) {
      promises.push(db.saveRequestUsage({
        provider: "google", model: "gemini-pro", connectionId: "cG",
        tokens: { prompt_tokens: 100, completion_tokens: 50 },
        status: "ok",
        timestamp: new Date(Date.now() + i).toISOString(),
      }));
    }
    await Promise.all(promises);

    const stats = await db.getUsageStats("7d");
    const g = stats.byProvider.google;
    expect(g).toBeDefined();
    expect(g.requests).toBe(N);
    expect(g.promptTokens).toBe(N * 100);
    expect(g.completionTokens).toBe(N * 50);
  });
});
