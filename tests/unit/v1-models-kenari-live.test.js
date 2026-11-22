import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setCatalogSource } from "../../open-sse/providers/capabilities.js";
import { getKenariProviderLive, setKenariCatalogFile } from "../../open-sse/providers/kenariCatalog.js";
import { normalizeKenariModels } from "../../src/lib/modelCatalog/kenariSync.js";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

const fixture = JSON.parse(
  fs.readFileSync(new URL("../fixtures/kenari-models.json", import.meta.url), "utf8"),
);

let dir;
let file;

function writeCatalog() {
  fs.writeFileSync(file, JSON.stringify({ v: 1, models: normalizeKenariModels(fixture) }));
  setKenariCatalogFile(file);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kenari-live-"));
  file = path.join(dir, "kenari-catalog.json");
  setKenariCatalogFile(file);
  setCatalogSource({ getModalities: () => null, getLimits: () => null, getProviderLive: getKenariProviderLive });
  db.getProviderConnections.mockResolvedValue([{ id: 1, provider: "kenari", isActive: true, providerSpecificData: {} }]);
});

afterEach(() => {
  setCatalogSource(null);
  setKenariCatalogFile(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

const ids = (list) => list.map((m) => m.id);

describe("/v1/models kenari live list", () => {
  it("lists the cached catalog with Kenari's limits and keeps image/tts/stt/video models out of the LLM list", async () => {
    writeCatalog();

    const llm = await buildModelsList(["llm"]);
    const muse = llm.find((m) => m.id === "kn/muse-ember-1-0");
    expect(muse).toMatchObject({ context_length: 1048576, max_completion_tokens: 524288 });
    expect(ids(llm)).toContain("kn/glm-4-7-flash:free");
    for (const nonChat of ["gemini-3-8-flash-lite-tts", "gpt-image-2", "gemini-omni-flash", "gpt-transcribe", "lyria-3-5"]) {
      expect(ids(llm)).not.toContain(`kn/${nonChat}`);
    }

  });

  it("falls back to the static list when there is no cache", async () => {
    const llm = await buildModelsList(["llm"]);
    expect(llm.some((m) => m.id.startsWith("kn/"))).toBe(true);
    expect(ids(llm)).not.toContain("kn/muse-ember-1-0");
  });

  it("applies Kenari's limits to explicitly enabled models too", async () => {
    writeCatalog();
    db.getProviderConnections.mockResolvedValue([
      { id: 1, provider: "kenari", isActive: true, providerSpecificData: { enabledModels: ["grok-4-7"] } },
    ]);
    const entry = (await buildModelsList(["llm"])).find((m) => m.id === "kn/grok-4-7");
    expect(entry).toMatchObject({ context_length: 500000, max_completion_tokens: 450000 });
  });
});
