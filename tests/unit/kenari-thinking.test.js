import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { vi } from "#test/vi";

import { getCapabilitiesForModel, setCatalogSource } from "../../open-sse/providers/capabilities.js";
import { KENARI_CATALOG_FILE, getKenariProviderLive, invalidateKenariCatalog } from "../../open-sse/providers/kenariCatalog.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { normalizeKenariModels } from "../../src/lib/modelCatalog/kenariSync.js";

const mocks = vi.hoisted(() => ({ getProviderConnectionById: vi.fn() }));
vi.mock("@/models", async () => ({
  ...(await import("@/models?actual")), getProviderConnectionById: mocks.getProviderConnectionById }));

const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");

const fixture = JSON.parse(
  fs.readFileSync(new URL("../fixtures/kenari-models.json", import.meta.url), "utf8"),
);
const LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"];

vi.mock("@/lib/dataDir.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return { DATA_DIR: mkdtempSync(join(tmpdir(), "kenari-test-")) };
});

function install(models) {
  fs.writeFileSync(KENARI_CATALOG_FILE, JSON.stringify({ v: 1, models }));
  invalidateKenariCatalog();
  setCatalogSource({ getModalities: () => null, getLimits: () => null, getProviderLive: getKenariProviderLive });
}

const MUSE = { contextWindow: 1048576, maxOutput: 524288, reasoning: true, reasoningToggle: false, reasoningLevels: LEVELS };

afterEach(() => {
  setCatalogSource(null);
  fs.rmSync(KENARI_CATALOG_FILE, { force: true });
  invalidateKenariCatalog();
  mocks.getProviderConnectionById.mockReset();
});

describe("normalizer keeps reasoning fields", () => {
  it("keeps toggle and known levels, drops unknown levels and bad types", () => {
    const models = normalizeKenariModels(fixture);
    expect(models["muse-ember-1-0"]).toMatchObject({ reasoning: true, reasoningToggle: false, reasoningLevels: LEVELS });
    const odd = normalizeKenariModels({
      data: [{ id: "x", reasoning: true, reasoning_toggle: "yes", supported_reasoning_levels: ["low", "turbo", 5, "low", "max"] }],
    });
    expect(odd.x.reasoningLevels).toEqual(["low", "max"]);
    expect(odd.x).not.toHaveProperty("reasoningToggle");
    const none = normalizeKenariModels({ data: [{ id: "y", supported_reasoning_levels: ["turbo"] }] });
    expect(none.y).not.toHaveProperty("reasoningLevels");
  });
});

describe("getThinkingLevels for kenari", () => {
  it("uses Kenari's levels, with none only when the toggle is on (id and kn alias)", () => {
    install({
      "muse-ember-1-0": MUSE,
      "toggle-model": { reasoning: true, reasoningToggle: true, reasoningLevels: ["low", "high"] },
      "plain-model": { reasoning: false, reasoningLevels: ["low"] },
    });
    expect(getThinkingLevels("kenari", "muse-ember-1-0")).toEqual(LEVELS);
    expect(getThinkingLevels("kn", "muse-ember-1-0")).toEqual(LEVELS);
    expect(getThinkingLevels("kenari", "toggle-model")).toEqual(["none", "low", "high"]);
    expect(getThinkingLevels("kenari", "plain-model")).toBeNull();
  });

  it("turns reasoning on and forbids disabling when the toggle is off", () => {
    install({ "muse-ember-1-0": MUSE, "toggle-model": { reasoning: true, reasoningToggle: true, reasoningLevels: ["low"] } });
    expect(getCapabilitiesForModel("kenari", "muse-ember-1-0")).toMatchObject({ reasoning: true, thinkingCanDisable: false });
    expect(getCapabilitiesForModel("kenari", "toggle-model").thinkingCanDisable).toBe(true);
  });

  it("falls back to the existing behaviour without a catalog or for old-shaped entries", () => {
    const before = getThinkingLevels("kenari", "gpt-5-6-sol");
    install({ "gpt-5-6-sol": { contextWindow: 1000 } });
    expect(getThinkingLevels("kenari", "gpt-5-6-sol")).toEqual(before);
    setCatalogSource(null);
    expect(getThinkingLevels("kenari", "muse-ember-1-0")).toBeNull();
  });

  it("resolves Kenari's model:level effort suffix to the listed model", () => {
    install({ "muse-ember-1-0": MUSE, "glm-4-7-flash:free": { contextWindow: 200000 } });
    expect(getCapabilitiesForModel("kenari", "muse-ember-1-0:max")).toMatchObject({ contextWindow: 1048576, maxOutput: 524288, reasoning: true });
    expect(getThinkingLevels("kenari", "muse-ember-1-0:minimal")).toEqual(LEVELS);
    expect(getCapabilitiesForModel("kenari", "muse-ember-1-0:turbo").contextWindow).not.toBe(1048576);
    expect(getCapabilitiesForModel("kenari", "glm-4-7-flash:free").contextWindow).toBe(200000);
    expect(applyThinking("openai", "muse-ember-1-0:max", { model: "muse-ember-1-0:max", reasoning_effort: "high" }, "kenari").reasoning_effort).toBe("high");
  });

  it("leaves other providers untouched", () => {
    const codex = getThinkingLevels("codex", "gpt-5.6-sol");
    const opencode = getThinkingLevels("opencode", "muse-spark-1.3-contributor-free");
    install({ "muse-ember-1-0": MUSE, "gpt-5.6-sol": MUSE });
    expect(getThinkingLevels("codex", "gpt-5.6-sol")).toEqual(codex);
    expect(getThinkingLevels("opencode", "muse-spark-1.3-contributor-free")).toEqual(opencode);
    expect(getThinkingLevels("opencode", "muse-ember-1-0")).toBeNull();
  });
});

describe("wire-level effort for kenari/muse-ember-1-0", () => {
  const send = (format, level) => applyThinking(format, `muse-ember-1-0(${level})`, { model: "muse-ember-1-0" }, "kenari");

  beforeEach(() => install({ "muse-ember-1-0": MUSE }));

  it("openai chat passes every advertised level through (no xhigh/max clamp)", () => {
    for (const level of ["minimal", "low", "medium", "high", "xhigh", "max"]) {
      expect(send("openai", level).reasoning_effort, level).toBe(level);
    }
  });

  it("openai chat: none becomes the lowest level because the toggle is off", () => {
    expect(send("openai", "none").reasoning_effort).toBe("minimal");
  });

  it("openai chat: none is sent as none when the model can disable", () => {
    install({ "muse-ember-1-0": { ...MUSE, reasoningToggle: true } });
    expect(send("openai", "none").reasoning_effort).toBe("none");
  });

  it("clamps none to the model's own lowest level when it has no minimal", () => {
    install({ "muse-ember-1-0": { ...MUSE, reasoningLevels: ["low", "high"] } });
    expect(send("openai", "none").reasoning_effort).toBe("low");
  });

  it("responses uses reasoning.effort and keeps minimal (no OpenAI minimal->low clamp)", () => {
    for (const level of ["minimal", "xhigh", "max"]) {
      expect(send("openai-responses", level).reasoning, level).toEqual({ summary: "auto", effort: level });
    }
    expect(send("openai-responses", "none").reasoning.effort).toBe("minimal");
    expect(send("openai-responses", "max")).not.toHaveProperty("reasoning_effort");
  });

  it("claude messages uses output_config.effort, no thinking block when it cannot be disabled", () => {
    for (const level of ["minimal", "xhigh", "max"]) {
      const body = send("claude", level);
      expect(body.output_config, level).toEqual({ effort: level });
      expect(body).not.toHaveProperty("thinking");
    }
    expect(send("claude", "none").output_config).toEqual({ effort: "minimal" });
  });

  it("claude messages: none disables thinking when the toggle is on", () => {
    install({ "muse-ember-1-0": { ...MUSE, reasoningToggle: true } });
    expect(send("claude", "none").thinking).toEqual({ type: "disabled" });
    expect(send("claude", "max")).toMatchObject({ thinking: { type: "adaptive" }, output_config: { effort: "max" } });
  });

  it("reaches the wire through translateRequest for the chat transport", () => {
    const body = { model: "muse-ember-1-0", messages: [{ role: "user", content: "hi" }], reasoning_effort: "max" };
    const out = translateRequest("openai", "openai", "muse-ember-1-0", body, false, null, "kenari");
    expect(out.reasoning_effort).toBe("max");
    const none = translateRequest("openai", "openai", "muse-ember-1-0", { ...body, reasoning_effort: "none" }, false, null, "kenari");
    expect(none.reasoning_effort).toBe("minimal");
  });

  it("is unchanged for other providers", () => {
    const body = applyThinking("openai", "muse-ember-1-0(max)", {}, "opencode");
    expect(body).not.toHaveProperty("reasoning_effort");
  });
});

describe("/api/providers/[id]/models for kenari", () => {
  const get = async () => {
    mocks.getProviderConnectionById.mockResolvedValue({ id: "c1", provider: "kenari", apiKey: "k" });
    const res = await GET(new Request("http://x/api/providers/c1/models"), { params: Promise.resolve({ id: "c1" }) });
    return res.json();
  };

  it("serves the cached catalog with caps, levels and kinds", async () => {
    install(normalizeKenariModels(fixture));
    const { models } = await get();
    const muse = models.find((m) => m.id === "muse-ember-1-0");
    expect(muse.caps).toMatchObject({ contextWindow: 1048576, maxOutput: 524288, reasoning: true });
    expect(muse.thinkingLevels).toEqual(LEVELS);
    expect(models.find((m) => m.id === "gpt-image-2").kind).toBe("image");
    expect(models.find((m) => m.id === "gemini-3-8-flash-lite-tts").kind).toBe("tts");
    expect(models.find((m) => m.id === "gpt-image-2")).not.toHaveProperty("caps");
  });

  it("falls back to the static list with no cache", async () => {
    const { models } = await get();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id === "muse-ember-1-0")).toBe(false);
  });
});
