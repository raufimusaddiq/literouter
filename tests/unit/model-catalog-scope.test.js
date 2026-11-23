import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-catalog-"));
process.env.DATA_DIR = dataDir;
const catalogFile = path.join(dataDir, "model-catalog.json");

const upstream = {
  zai: { models: { "glm-4.6v": { modalities: { input: ["text", "image"] } } } },
  zhipuai: { models: { "glm-5-canary": { modalities: { input: ["text", "image", "pdf"] } } } },
  moonshotai: { models: { "kimi-k3": { modalities: { input: ["text"] } } } },
  kilo: { models: { "kilo-auto/efficient": { modalities: { input: ["text", "image"] } } } },
};
const entries = [
  { provider: "glm", model: "glm-4.6v", current: { contextWindow: 200000, maxOutput: 128000 } },
  { provider: "glm-cn", model: "glm-5-canary", current: { contextWindow: 200000, maxOutput: 128000 } },
  { provider: "zhipu", model: "glm-5-canary", current: { contextWindow: 200000, maxOutput: 128000 } },
  { provider: "kimi", model: "kimi-k3", current: { contextWindow: 128000, maxOutput: 32000 } },
];

let build, getCatalogModalities, invalidateCatalog, syncModelCatalog, startModelCatalogSync, capabilities;

beforeAll(async () => {
  ({ build, syncModelCatalog, startModelCatalogSync } = await import("../../src/lib/modelCatalog/sync.js"));
  expect(typeof build).toBe("function");
  const { models, providers } = build(upstream, entries);
  fs.writeFileSync(catalogFile, JSON.stringify({ v: 2, models, providers }));
  ({ getCatalogModalities, invalidateCatalog } = await import("../../open-sse/providers/catalogOverride.js"));
  capabilities = await import("../../open-sse/providers/capabilities.js");
});

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("model catalog", () => {
  it("keys modalities by gateway and writes no model-only key", () => {
    const { models } = build(upstream, entries);
    expect(models["glm:glm-4.6v"]).toEqual({ vision: true });
    expect(models["zai:glm-4.6v"]).toEqual({ vision: true });
    expect(models["kilo:efficient"]).toEqual({ vision: true });
    expect(models["glm-4.6v"]).toBeUndefined();
    expect(models["efficient"]).toBeUndefined();
    expect(models["kimi:kimi-k3"]).toBeUndefined();
  });

  it("files an upstream provider under every local id that aliases it", () => {
    const { models } = build(upstream, entries);
    expect(models["glm-cn:glm-5-canary"]).toEqual({ vision: true, pdf: true });
    expect(models["zhipu:glm-5-canary"]).toEqual({ vision: true, pdf: true });
    expect(models["zhipuai:glm-5-canary"]).toEqual({ vision: true, pdf: true });
    expect(getCatalogModalities("glm-cn", "glm-5-canary")).toEqual({ vision: true, pdf: true });
    expect(getCatalogModalities("zhipu", "glm-5-canary")).toEqual({ vision: true, pdf: true });
  });

  it("does not hand a router mode another vendor's modalities", () => {
    expect(getCatalogModalities("kilo", "kilo-auto/efficient")).toEqual({ vision: true });
    expect(getCatalogModalities("kilo-gateway", "kilo-auto/efficient")).toBeNull();
    expect(getCatalogModalities("qoder", "efficient")).toBeNull();
  });

  it("resolves a gateway the file was written for, and nobody else", () => {
    expect(getCatalogModalities("glm", "glm-4.6v")).toEqual({ vision: true });
    expect(getCatalogModalities("zai", "glm-4.6v")).toEqual({ vision: true });
    expect(getCatalogModalities("unrelated", "glm-4.6v")).toBeNull();
    expect(getCatalogModalities(undefined, "glm-4.6v")).toBeNull();
  });

  it("passes the gateway to the catalog reader when refining", () => {
    const seen = [];
    capabilities.setCatalogSource({
      getModalities: (provider) => {
        seen.push(provider);
        return provider === "gateway-a" ? { vision: true } : null;
      },
      getLimits: () => null,
    });
    try {
      expect(capabilities.getCapabilitiesForModel("gateway-a", "laguna-9-preview").vision).toBe(true);
      expect(capabilities.getCapabilitiesForModel("gateway-b", "laguna-9-preview").vision).toBe(false);
      expect(seen).toContain("gateway-a");
    } finally {
      capabilities.setCatalogSource(null);
    }
  });

  it("shares the installed source with every copy of the module", async () => {
    const source = {
      getModalities: (provider) => (provider === "gateway-a" ? { vision: true } : null),
      getLimits: () => null,
    };
    capabilities.setCatalogSource(source);
    try {
      expect(globalThis.__9rCatalogSource).toBe(source);
      const other = await import("../../open-sse/providers/capabilities.js?copy=2");
      expect(other.getCapabilitiesForModel).not.toBe(capabilities.getCapabilitiesForModel);
      expect(other.getCapabilitiesForModel("gateway-a", "laguna-9-preview").vision).toBe(true);
    } finally {
      capabilities.setCatalogSource(null);
    }
    expect(globalThis.__9rCatalogSource).toBeNull();
  });

  it("detaches the source from a copy that already resolved through it", async () => {
    capabilities.setCatalogSource({
      getModalities: (provider) => (provider === "gateway-a" ? { vision: true } : null),
      getLimits: () => null,
    });
    const other = await import("../../open-sse/providers/capabilities.js?copy=3");
    try {
      expect(other.getCapabilitiesForModel("gateway-a", "laguna-9-preview").vision).toBe(true);
    } finally {
      capabilities.setCatalogSource(null);
    }
    expect(other.getCapabilitiesForModel("gateway-a", "laguna-9-preview").vision).toBe(false);
  });
});

describe("catalog schema", () => {
  it("ignores a file written before the keys were scoped", () => {
    const scoped = fs.readFileSync(catalogFile);
    fs.writeFileSync(catalogFile, JSON.stringify({ v: 1, models: { "kimi-k3": { vision: true } }, providers: {} }));
    invalidateCatalog();
    expect(getCatalogModalities("kimi", "kimi-k3")).toBeNull();
    fs.writeFileSync(catalogFile, scoped);
    invalidateCatalog();
  });

  it("rebuilds an older-schema file instead of trusting its etag", async () => {
    fs.writeFileSync(catalogFile, JSON.stringify({ v: 1, etag: 'W/"old"', models: {}, providers: {} }));
    invalidateCatalog();
    startModelCatalogSync();

    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
      sent.push(options?.headers || {});
      return { ok: true, status: 200, headers: new Map([["etag", 'W/"new"']]), json: async () => upstream };
    };
    try {
      expect((await syncModelCatalog()).status).toBe("updated");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(sent[0]["if-none-match"]).toBeUndefined();
    const written = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
    expect(written.v).toBe(2);
    expect(written.models["glm:glm-4.6v"]).toEqual({ vision: true });
  });

  it("asks upstream for a 304 once the file is current", async () => {
    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
      sent.push(options?.headers || {});
      return { ok: false, status: 304, headers: new Map(), json: async () => ({}) };
    };
    try {
      expect((await syncModelCatalog()).status).toBe("unchanged");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(sent[0]["if-none-match"]).toBe('W/"new"');
  });
});
