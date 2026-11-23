import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";


const caps = (id, provider = "zai") => getCapabilitiesForModel(provider, id);

describe("GLM 5.2/5.3 are 1M (#4544)", () => {
  it.each([
    "glm-5.3",
    "glm-5.3-flash",
    "glm-5.3-highspeed",
    "glm-5.3-prime",
  ])("%s advertises 1M, not the stale 200k pin", (id) => {
    expect(caps(id).contextWindow).toBe(1000000);
  });

  it("glm-5.2 is 1M too — the same stale pin applied to it", () => {
    expect(caps("glm-5.2").contextWindow).toBe(1000000);
  });

  it("resolves the same way for every provider, not just zai", () => {
    for (const p of ["zai", "glm-cn"]) {
      expect(caps("glm-5.3", p).contextWindow, p).toBe(1000000);
    }
  });

  it.each(["glm-5.1", "glm-5-turbo", "glm-5v-turbo", "glm-5", "glm-5.0"])(
    "%s keeps its real ~200k window",
    (id) => {
      expect(caps(id).contextWindow).toBe(200000);
    }
  );

  it("still does not gate reasoning_effort for the pre-5.2 models", () => {
    for (const id of ["glm-5.1", "glm-5-turbo", "glm-5"]) {
      expect(caps(id).thinkingEffortSupported, id).toBeFalsy();
    }
  });
});