import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { vi } from "#test/vi";

import { getCapabilitiesForModel, setCatalogSource } from "../../open-sse/providers/capabilities.js";
import {
  KENARI_CATALOG_FILE,
  getKenariProviderLive,
  invalidateKenariCatalog,
  listKenariModels,
} from "../../open-sse/providers/kenariCatalog.js";
import { normalizeKenariModels } from "../../src/lib/modelCatalog/kenariSync.js";

const fixture = JSON.parse(
  fs.readFileSync(new URL("../fixtures/kenari-models.json", import.meta.url), "utf8"),
);

vi.mock("@/lib/dataDir.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return { DATA_DIR: mkdtempSync(join(tmpdir(), "kenari-test-")) };
});

function install({ overlay } = {}) {
  setCatalogSource({
    getModalities: () => null,
    getLimits: (provider) => (overlay && provider === "kenari" ? overlay : null),
    getProviderLive: getKenariProviderLive,
  });
}

function writeCatalog(models = normalizeKenariModels(fixture)) {
  writeRaw(JSON.stringify({ v: 1, models }));
}

function writeRaw(contents) {
  fs.writeFileSync(KENARI_CATALOG_FILE, contents);
  invalidateKenariCatalog();
}

afterEach(() => {
  setCatalogSource(null);
  fs.rmSync(KENARI_CATALOG_FILE, { force: true });
  invalidateKenariCatalog();
});

describe("normalizeKenariModels", () => {
  const models = normalizeKenariModels(fixture);

  it("maps limits, modalities, reasoning and tools", () => {
    expect(models["muse-ember-1-0"]).toMatchObject({
      name: "Muse Ember 1.0",
      kind: "llm",
      contextWindow: 1048576,
      maxOutput: 524288,
      vision: true,
      pdf: true,
      reasoning: true,
      tools: true,
    });
    expect(models["muse-ember-1-0"]).not.toHaveProperty("audioInput");
  });

  it("omits maxOutput when Kenari does not publish it", () => {
    expect(models["beam-1-0:free"].contextWindow).toBe(262144);
    expect(models["beam-1-0:free"]).not.toHaveProperty("maxOutput");
  });

  it("classifies non-chat models by endpoint and gives them no limits", () => {
    expect(models["gemini-3-8-flash-lite-tts"].kind).toBe("tts");
    expect(models["gpt-image-2"].kind).toBe("image");
    expect(models["gpt-image-2"]).not.toHaveProperty("contextWindow");
  });

  it("keeps the :free variant as its own entry and tolerates junk input", () => {
    expect(models["glm-4-7-flash:free"].maxOutput).toBe(117964);
    expect(normalizeKenariModels(null)).toEqual({});
    expect(normalizeKenariModels({ data: [null, {}, { id: 5 }] })).toEqual({});
    const hostile = normalizeKenariModels({ data: [{ id: "__proto__", context_length: 5 }] });
    expect(Object.getPrototypeOf(hostile)).toBe(Object.prototype);
    expect(Object.hasOwn(hostile, "__proto__")).toBe(true);
  });
});

describe("capability precedence for kenari", () => {
  it("Kenari's numbers beat the tables, for the id and the kn alias", () => {
    writeCatalog();
    install();
    for (const provider of ["kenari", "kn"]) {
      expect(getCapabilitiesForModel(provider, "muse-ember-1-0")).toMatchObject({
        contextWindow: 1048576,
        maxOutput: 524288,
      });
    }
    expect(getCapabilitiesForModel("kenari", "glm-5-3").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kenari", "grok-4-7")).toMatchObject({ contextWindow: 500000, maxOutput: 450000 });
    expect(getCapabilitiesForModel("kenari", "minimax-m3").maxOutput).toBe(235929);
  });

  it("beats the models.dev overlay", () => {
    writeCatalog();
    install({ overlay: { contextWindow: 123456, maxOutput: 7890 } });
    expect(getCapabilitiesForModel("kenari", "muse-ember-1-0")).toMatchObject({
      contextWindow: 1048576,
      maxOutput: 524288,
    });
  });

  it("beats the MODEL/PATTERN tables", () => {
    writeCatalog({ "gpt-6-luna": { contextWindow: 4242, maxOutput: 99 } });
    install();
    expect(getCapabilitiesForModel("kenari", "gpt-6-luna")).toMatchObject({ contextWindow: 4242, maxOutput: 99 });
  });

  it("keeps table values for fields Kenari omits", () => {
    writeCatalog();
    install();
    const live = getCapabilitiesForModel("kenari", "beam-1-0:free");
    setCatalogSource(null);
    const tables = getCapabilitiesForModel("kenari", "beam-1-0:free");
    expect(live.contextWindow).toBe(262144);
    expect(live.maxOutput).toBe(tables.maxOutput);
  });

  it("only turns modalities on, never off", () => {
    writeCatalog({ "claude-sonnet-4-6": { contextWindow: 1000, maxOutput: 10, vision: false } });
    install();
    const sonnet = getCapabilitiesForModel("kenari", "claude-sonnet-4-6");
    expect(sonnet).toMatchObject({ contextWindow: 1000, maxOutput: 10 });
    setCatalogSource(null);
    expect(sonnet.vision).toBe(getCapabilitiesForModel("kenari", "claude-sonnet-4-6").vision);
  });

  it("matches ids exactly and does not strip :free", () => {
    writeCatalog();
    install();
    expect(getCapabilitiesForModel("kenari", "glm-4-7-flash:free").maxOutput).toBe(117964);
    expect(getCapabilitiesForModel("kenari", "glm-4-7-flash").maxOutput).not.toBe(117964);
  });

  it("never resolves inherited property names", () => {
    writeCatalog();
    install();
    for (const id of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(() => getCapabilitiesForModel("kenari", id)).not.toThrow();
      expect(getKenariProviderLive("kenari", id)).toBeNull();
    }
  });

  it("leaves other providers untouched", () => {
    const opencode = getCapabilitiesForModel("opencode", "muse-ember-1.0");
    const opencodeDash = getCapabilitiesForModel("opencode", "muse-ember-1-0");
    const claude = getCapabilitiesForModel("claude", "claude-sonnet-4-6");
    writeCatalog();
    install();
    expect(getCapabilitiesForModel("opencode", "muse-ember-1.0")).toEqual(opencode);
    expect(getCapabilitiesForModel("opencode", "muse-ember-1-0")).toEqual(opencodeDash);
    expect(getCapabilitiesForModel("claude", "claude-sonnet-4-6")).toEqual(claude);
    expect(opencodeDash.contextWindow).not.toBe(1048576);
  });

  it("behaves as before when no catalog source is installed", () => {
    writeCatalog();
    expect(getCapabilitiesForModel("kenari", "muse-ember-1-0").contextWindow).not.toBe(1048576);
  });
});

describe("fail open", () => {
  it("falls back to the tables when the file is missing", () => {
    install();
    expect(listKenariModels()).toBeNull();
    expect(getKenariProviderLive("kenari", "muse-ember-1-0")).toBeNull();
    expect(getCapabilitiesForModel("kenari", "muse-ember-1-0").contextWindow).toBeGreaterThan(0);
  });

  it("falls back to the tables when the file is corrupt or the wrong shape", () => {
    install();
    for (const contents of ["{not json", "[]", JSON.stringify({ models: [1, 2] }), JSON.stringify({ models: null })]) {
      writeRaw(contents);
      expect(getKenariProviderLive("kenari", "muse-ember-1-0")).toBeNull();
      expect(listKenariModels()).toBeNull();
      expect(() => getCapabilitiesForModel("kenari", "muse-ember-1-0")).not.toThrow();
    }
  });

  it("survives a throwing hook", () => {
    setCatalogSource({
      getModalities: () => null,
      getLimits: () => null,
      getProviderLive: vi.fn(() => {
        throw new Error("boom");
      }),
    });
    expect(() => getCapabilitiesForModel("kenari", "muse-ember-1-0")).not.toThrow();
  });

  it("picks up a rewritten file", () => {
    writeCatalog({ "muse-ember-1-0": { contextWindow: 111 } });
    install();
    expect(getCapabilitiesForModel("kenari", "muse-ember-1-0").contextWindow).toBe(111);
    writeRaw(JSON.stringify({ models: { "muse-ember-1-0": { contextWindow: 222 } } }));
    expect(getCapabilitiesForModel("kenari", "muse-ember-1-0").contextWindow).toBe(222);
  });
});
