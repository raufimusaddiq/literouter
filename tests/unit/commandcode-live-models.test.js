import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";

const CATALOG_URL = "https://api.commandcode.ai/provider/v1/models?view=client";

const stub = vi.hoisted(() => ({ mode: "ok", calls: [] }));

stub.catalog = {
  catalogVersion: "catalog-abc123",
  object: "list",
  refreshAfterSeconds: 900,
  data: [
    {
      id: "claude-sonnet-5-5",
      name: "Claude Sonnet 5.5",
      context_length: 1000000,
      inputModalities: ["text", "image"],
      reasoningEfforts: ["low", "medium", "high"],
      display: { label: "Claude Sonnet 5.5", description: "best combo of speed & intelligence" },
    },
    {
      id: "deepseek/deepseek-v4.1-flash-fast",
      name: "DeepSeek V4.1 Flash Fast",
      context_length: 1000000,
      maxOutputTokens: 262144,
      inputModalities: ["text"],
      reasoningEfforts: null,
      pricing: { inputCost: 0.15, outputCost: 0.6, cacheReadCost: 0.003 },
      display: { label: "DeepSeek V4.1 Flash Fast (latest)", description: "High throughput V4.1 Flash" },
    },
    {
      id: "stealth/glyph-cluster:free",
      hidden: true,
      context_length: 256000,
      inputModalities: ["text"],
      reasoningEfforts: ["high"],
      display: { label: "Glyph Cluster" },
    },
  ],
};

beforeEach(async () => {
  stub.mode = "ok";
  stub.calls.length = 0;
  const { resetCommandCodeCache } = await import("open-sse/services/commandcodeModels.js");
  resetCommandCodeCache();
  vi.stubGlobal("fetch", async (url, options) => {
    const href = String(url);
    stub.calls.push({ url: href, headers: options?.headers || {} });
    if (href !== CATALOG_URL) return new Response("unexpected url", { status: 404 });
    if (stub.mode === "error") return new Response("boom", { status: 500 });
    if (stub.mode === "empty") return Response.json({ data: [] });
    return Response.json(stub.catalog);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const originalDataDir = process.env.DATA_DIR;
let GET;
let createProviderConnection;

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "9router-commandcode-live-"));
  vi.resetModules();
  ({ GET } = await import("@/app/api/providers/[id]/models/route.js"));
  ({ createProviderConnection } = await import("@/models/index.js"));
});

afterAll(() => {
  try {
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  } catch {
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function seedCommandCode(n) {
  return createProviderConnection({
    provider: "commandcode",
    authType: "apikey",
    name: `commandcode-live-${n}-${Date.now()}`,
    apiKey: `user_live_${n}_${Date.now()}`,
    testStatus: "active",
  });
}

async function getModels(connectionId) {
  const req = new Request(`http://localhost/api/providers/${connectionId}/models`);
  return GET(req, { params: Promise.resolve({ id: connectionId }) });
}

describe("CommandCode catalog — live models reach the dashboard", () => {
  it("returns the vendor catalog with display copy and capability flags", async () => {
    const conn = await seedCommandCode("m1");
    const res = await getModels(conn.id);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.models.map((m) => m.id).sort()).toEqual([
      "claude-sonnet-5-5",
      "deepseek/deepseek-v4.1-flash-fast",
    ]);

    const sonnet = data.models.find((m) => m.id === "claude-sonnet-5-5");
    expect(sonnet.name).toBe("Claude Sonnet 5.5");
    expect(sonnet.description).toBe("best combo of speed & intelligence");
    expect(sonnet.contextLength).toBe(1000000);
    expect(sonnet.isVL).toBe(true);
    expect(sonnet.isReasoning).toBe(true);

    const flash = data.models.find((m) => m.id === "deepseek/deepseek-v4.1-flash-fast");
    expect(flash.name).toBe("DeepSeek V4.1 Flash Fast (latest)");
    expect(flash.maxOutputTokens).toBe(262144);
    expect(flash.isVL).toBe(false);
    expect(flash.isReasoning).toBe(false);
  });

  it("drops hidden aliases the vendor CLI keeps out of its picker", async () => {
    const conn = await seedCommandCode("m2");
    const data = await (await getModels(conn.id)).json();
    expect(data.models.some((m) => m.id === "stealth/glyph-cluster:free")).toBe(false);
  });

  it("identifies as the CommandCode CLI and never leaks the connection key", async () => {
    const conn = await seedCommandCode("m3");
    const res = await getModels(conn.id);
    const data = await res.json();

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].url).toBe(CATALOG_URL);
    expect(stub.calls[0].headers["x-command-code-version"]).toBeTruthy();
    expect(stub.calls[0].headers["x-cli-surface"]).toBe("cli");

    expect(JSON.stringify(data)).not.toContain(conn.apiKey);
    expect(JSON.stringify(data)).not.toContain("user_live");
  });
});

describe("CommandCode catalog — failure handling", () => {
  it("surfaces the upstream status instead of crashing", async () => {
    stub.mode = "error";
    const conn = await seedCommandCode("e1");
    const res = await getModels(conn.id);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.warning).toMatch(/no live models/i);
    expect(data.models.length).toBeGreaterThan(0);
  });

  it("rejects a 500 or an empty catalog without throwing out of the route", async () => {
    const { resolveCommandCodeModels } = await import("open-sse/services/commandcodeModels.js");
    stub.mode = "error";
    expect(await resolveCommandCodeModels({ forceRefresh: true })).toBeNull();
    stub.mode = "empty";
    expect(await resolveCommandCodeModels({ forceRefresh: true })).toBeNull();
  });

  it("caches a successful catalog between calls", async () => {
    const { resolveCommandCodeModels } = await import("open-sse/services/commandcodeModels.js");
    stub.mode = "ok";
    const first = await resolveCommandCodeModels({ forceRefresh: true });
    expect(first.models.length).toBe(2);
    const callsAfterFirst = stub.calls.length;
    const second = await resolveCommandCodeModels();
    expect(second.models.length).toBe(2);
    expect(stub.calls.length).toBe(callsAfterFirst);
  });

  it("throttles forceRefresh to one fetch per minute", async () => {
    const { resolveCommandCodeModels } = await import("open-sse/services/commandcodeModels.js");
    stub.mode = "ok";
    await resolveCommandCodeModels({ forceRefresh: true });
    const afterFirst = stub.calls.length;
    const again = await resolveCommandCodeModels({ forceRefresh: true });
    expect(stub.calls.length).toBe(afterFirst);
    expect(again.models.length).toBe(2);
  });

  it("honors the failure backoff even when forceRefresh is set", async () => {
    const { resolveCommandCodeModels } = await import("open-sse/services/commandcodeModels.js");
    stub.mode = "error";
    expect(await resolveCommandCodeModels({ forceRefresh: true })).toBeNull();
    const afterFailure = stub.calls.length;
    expect(await resolveCommandCodeModels({ forceRefresh: true })).toBeNull();
    expect(await resolveCommandCodeModels()).toBeNull();
    expect(stub.calls.length).toBe(afterFailure);
  });

  it("404s for an unknown connection", async () => {
    const res = await getModels("00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });
});

describe("CommandCode catalog — vendor rates are billed, not $0", () => {
  it("registers the catalog's own pricing for live ids", async () => {
    const { resolveCommandCodeModels } = await import("open-sse/services/commandcodeModels.js");
    const { getPricingForModel, clearRuntimePricing } = await import("open-sse/providers/pricing.js");
    stub.mode = "ok";
    clearRuntimePricing("commandcode");
    await resolveCommandCodeModels({ forceRefresh: true });
    expect(getPricingForModel("commandcode", "deepseek/deepseek-v4.1-flash-fast")).toMatchObject({
      input: 0.15, output: 0.6, cached: 0.003,
    });
    clearRuntimePricing("commandcode");
  });
});

describe("GET /v1/models — the gateway advertises the live catalog", () => {
  it("replaces the static registry list for the cmc alias", async () => {
    const { buildModelsList } = await import("@/app/api/v1/models/route.js");
    const ids = (await buildModelsList(["llm"])).map((m) => m.id);
    expect(ids).toContain("cmc/claude-sonnet-5-5");
    expect(ids).toContain("cmc/deepseek/deepseek-v4.1-flash-fast");
    expect(ids).not.toContain("cmc/stealth/glyph-cluster:free");
  });
});
