import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { describe, it, expect, beforeAll } from "bun:test";
import { useTempDataDir } from "#test/tempDataDir";
import {
  getInputTokens,
  getCachedTokens,
  getCacheCreationTokens,
} from "@/web/pages/dashboard/usage/components/tokenDisplay.js";

useTempDataDir("9router-details-tab-", { scope: "all" });
let db;
let adapter;

async function saveDetail(detail) {
  await db.saveRequestDetail(detail);
  await db.flushRequestDetails();
}

beforeAll(async () => {
  db = await import("@/lib/db/index.js");
  await db.initDb();
  await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1 });

  const { getAdapter } = await import("@/lib/db/driver.js");
  adapter = await getAdapter();
});

describe("request details — tab crash-risk cases", () => {
  it("corrupt data column → parseJson fallback {}, no throw", async () => {
    adapter.run(
      `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      ["corrupt-1", new Date().toISOString(), "openai", "gpt-4", null, "ok", "{not-valid-json"]
    );

    const res = await db.getRequestDetails({ provider: "openai" });
    expect(Array.isArray(res.details)).toBe(true);
    const corrupt = res.details.find((d) => Object.keys(d).length === 0);
    expect(corrupt).toEqual({});
  });

  it("pagination beyond last page → empty details, valid meta", async () => {
    const res = await db.getRequestDetails({ page: 9999, pageSize: 20 });
    expect(res.details).toEqual([]);
    expect(res.pagination.page).toBe(9999);
    expect(res.pagination.hasNext).toBe(false);
    expect(res.pagination.totalItems).toBeGreaterThanOrEqual(0);
  });

  it("invalid startDate → Invalid Date ISO throws inside getRequestDetails is caught upstream", async () => {
    await expect(db.getRequestDetails({ startDate: "not-a-date" })).rejects.toThrow();
  });

  it("valid date filter range → no throw", async () => {
    const res = await db.getRequestDetails({
      startDate: "2020-01-01T00:00:00",
      endDate: "2999-01-01T00:00:00",
    });
    expect(Array.isArray(res.details)).toBe(true);
  });

  it("large pageSize (providers route uses 9999) → returns all, no crash", async () => {
    await saveDetail({
      id: "big-1", provider: "anthropic", model: "claude-3",
      status: "ok", tokens: { input_tokens: 5 },
      request: { method: "POST" }, response: { content: "hi" },
    });

    const res = await db.getRequestDetails({ pageSize: 9999 });
    expect(res.details.length).toBeGreaterThanOrEqual(1);
    expect(res.pagination.pageSize).toBe(9999);
  });

  it("oversized field → stored truncated + reparseable (no circular)", async () => {
    const huge = "x".repeat(20 * 1024);
    await saveDetail({
      id: "trunc-1", provider: "openai", model: "gpt-4",
      status: "ok", tokens: {},
      request: { blob: huge }, response: { content: "ok" },
    });

    const got = await db.getRequestDetailById("trunc-1");
    expect(got).toBeDefined();
    expect(() => JSON.stringify(got)).not.toThrow();
    expect(got.request._truncated).toBe(true);
  });

  it("missing tokens/timestamp on row → getInputTokens-style access safe", async () => {
    adapter.run(
      `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      ["sparse-1", new Date().toISOString(), "openai", null, null, null, JSON.stringify({ id: "sparse-1" })]
    );
    const got = await db.getRequestDetailById("sparse-1");
    expect(got.tokens).toBeUndefined();
    expect(got.tokens?.prompt_tokens || 0).toBe(0);
  });
});

describe("backupDbLite — excludes requestDetails, keeps critical data", () => {
  it("backup file omits requestDetails rows but keeps other tables", async () => {
    const { backupDbLite } = await import("@/lib/db/backup.js");
    await saveDetail({ id: "bk-1", provider: "openai", model: "m", status: "ok", tokens: {}, request: {}, response: {} });

    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-bklite-"));
    const dest = backupDbLite(adapter, backupDir);
    expect(fs.existsSync(dest)).toBe(true);

    const bak = new Database(dest, { readonly: true });
    try {
      const rdTable = bak.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='requestDetails'").get();
      expect(rdTable).toBeNull();
      const st = bak.prepare("SELECT COUNT(*) c FROM settings").get();
      expect(st.c).toBeGreaterThanOrEqual(1);
    } finally {
      bak.close(true);
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  });
});

describe("getDistinctProviders — providers route (no full-row parse)", () => {
  it("returns unique provider list without parsing data blobs", async () => {
    await saveDetail({ id: "dp-1", provider: "openai", model: "m", status: "ok", tokens: {}, request: {}, response: {} });
    await saveDetail({ id: "dp-2", provider: "anthropic", model: "m", status: "ok", tokens: {}, request: {}, response: {} });
    await saveDetail({ id: "dp-3", provider: "openai", model: "m", status: "ok", tokens: {}, request: {}, response: {} });

    const list = await db.getDistinctProviders();
    expect(Array.isArray(list)).toBe(true);
    expect(list).toContain("openai");
    expect(list).toContain("anthropic");
    expect(new Set(list).size).toBe(list.length);
  });

  it("skips null providers, returns sorted", async () => {
    const list = await db.getDistinctProviders();
    expect(list.every((p) => p !== null)).toBe(true);
    const sorted = [...list].sort();
    expect(list).toEqual(sorted);
  });
});

describe("token helpers — render-time crash safety", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty object", {}],
  ])("all helpers return 0 for %s", (label, tokens) => {
    expect(getInputTokens(tokens)).toBe(0);
    expect(getCachedTokens(tokens)).toBe(0);
    expect(getCacheCreationTokens(tokens)).toBe(0);
  });

  it.each([
    [{ prompt_tokens: 100 }, 100],
    [{ input_tokens: 50 }, 50],
  ])("input tokens from %p → %d", (tokens, expected) => {
    expect(getInputTokens(tokens)).toBe(expected);
  });

  it("legacy Claude row (prompt < cache) → returns cache", () => {
    expect(getInputTokens({ prompt_tokens: 10, cached_tokens: 200 })).toBe(200);
  });

  it("cached via cache_read_input_tokens alias", () => {
    expect(getCachedTokens({ cache_read_input_tokens: 42 })).toBe(42);
  });

  it("toLocaleString on helper result never throws", () => {
    expect(() => getInputTokens(undefined).toLocaleString()).not.toThrow();
  });
});

describe("API route contract — validation boundary", () => {
  let GET;
  beforeAll(async () => {
    ({ GET } = await import("@/app/api/usage/request-details/route.js"));
  });

  function makeReq(query) {
    return new Request(`http://localhost/api/usage/request-details?${query}`);
  }

  it("page=0 → 400 (guard now reachable after NaN-check fix)", async () => {
    const res = await GET(makeReq("page=0"));
    expect(res.status).toBe(400);
  });

  it("page=-5 → 400", async () => {
    const res = await GET(makeReq("page=-5"));
    expect(res.status).toBe(400);
  });

  it("pageSize=101 → 400", async () => {
    const res = await GET(makeReq("pageSize=101"));
    expect(res.status).toBe(400);
  });

  it("pageSize=abc (NaN) → defaults to 20, returns 200", async () => {
    const res = await GET(makeReq("pageSize=abc"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination.pageSize).toBe(20);
  });

  it("invalid startDate → route catches, returns 500 (not thrown)", async () => {
    const res = await GET(makeReq("startDate=not-a-date"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("valid request → 200 with details + pagination shape", async () => {
    const res = await GET(makeReq("page=1&pageSize=20"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 20 });
  });
});
