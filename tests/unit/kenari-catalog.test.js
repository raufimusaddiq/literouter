import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCapabilitiesForModel, setCatalogSource } from "../../open-sse/providers/capabilities.js";
import {
  getKenariProviderLive,
  listKenariModels,
  setKenariCatalogFile,
} from "../../open-sse/providers/kenariCatalog.js";
import { normalizeKenariModels } from "../../src/lib/modelCatalog/kenariSync.js";

const fixture = JSON.parse(
  fs.readFileSync(new URL("../fixtures/kenari-models.json", import.meta.url), "utf8"),
);

let dir;
let file;

function install({ overlay } = {}) {
  setCatalogSource({
    getModalities: () => null,
    getLimits: (provider) => (overlay && provider === "kenari" ? overlay : null),
    getProviderLive: getKenariProviderLive,
  });
}

function writeCatalog(models = normalizeKenariModels(fixture)) {
  fs.writeFileSync(file, JSON.stringify({ v: 1, syncedAt: 1, models }));
  setKenariCatalogFile(file); // also drops the cached copy
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kenari-catalog-"));
  file = path.join(dir, "kenari-catalog.json");
  setKenariCatalogFile(file);
});

afterEach(() => {
  setCatalogSource(null);
  setKenariCatalogFile(null);
  fs.rmSync(dir, { recursive: true, force: true });
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
    expect(models["gemini-omni-flash"].kind).toBe("video");
    expect(models["gpt-transcribe"].kind).toBe("stt");
    expect(models["lyria-3-5"].kind).toBe("music");
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

  it("beats PROVIDER_CAPABILITIES-level overrides (kenari id resolved via the live hook last)", () => {
    // gpt-6-luna is a MODEL/PATTERN-table entry; a Kenari entry for it must win.
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
    // Not in Kenari's list as a bare id: the tables decide, not the :free entry.
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
      fs.writeFileSync(file, contents);
      setKenariCatalogFile(file);
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
    fs.writeFileSync(file, JSON.stringify({ models: { "muse-ember-1-0": { contextWindow: 222 } } }));
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(file, future, future);
    expect(getCapabilitiesForModel("kenari", "muse-ember-1-0").contextWindow).toBe(222);
  });
});
