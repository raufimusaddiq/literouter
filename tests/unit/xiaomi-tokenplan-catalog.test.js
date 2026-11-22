import { describe, expect, it } from "vitest";
import tokenplan from "../../open-sse/providers/registry/xiaomi-tokenplan.js";
import { getModelsByProviderId } from "../../src/shared/constants/models.js";

describe("xiaomi-tokenplan catalog", () => {
  it("advertises the current Token Plan models", () => {
    const ids = tokenplan.models.map((m) => m.id);
    expect(ids).toContain("mimo-v2.6-pro");
    expect(ids).toContain("mimo-v2.6-flash");
    expect(ids).toContain("mimo-v2.5-asr");
  });

  it("drops the ids retired upstream on 2026-10-21", () => {
    const ids = tokenplan.models.map((m) => m.id);
    for (const dead of ["mimo-v2.5-pro", "mimo-v2.5", "mimo-v2-pro", "mimo-v2-omni", "mimo-v2.5-pro-claude"]) {
      expect(ids).not.toContain(dead);
    }
  });

  it("keeps the modality kinds the router dispatches on", () => {
    const byId = new Map(tokenplan.models.map((m) => [m.id, m]));
    expect(byId.get("mimo-v2.5-asr").kind).toBe("stt");
    expect(byId.get("mimo-v2.5-tts").kind).toBe("tts");
    expect(byId.get("mimo-v2.6-pro").kind).toBeUndefined();
  });

  it("is wired into the shared model table", () => {
    expect(getModelsByProviderId("xiaomi-tokenplan").map((m) => m.id)).toContain("mimo-v2.6-pro");
  });
});
