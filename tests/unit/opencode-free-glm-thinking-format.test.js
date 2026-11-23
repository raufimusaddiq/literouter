import { describe, expect, it } from "vitest";

import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

const LANES = ["opencode", "opencode-zen"];

describe("OpenCode free GLM-5.3-Flash travels as OpenAI reasoning_effort", () => {
  it.each(LANES)("%s sends reasoning_effort and never a zai thinking object", (provider) => {
    const body = { reasoning_effort: "high", messages: [{ role: "user", content: "hi" }] };
    applyThinking("openai", "glm-5.3-flash-free", body, provider);
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning_effort).toBe("high");
  });

  it.each(LANES)("%s keeps the effort picker free of the zai on/off pair", (provider) => {
    const levels = getThinkingLevels(provider, "glm-5.3-flash-free");
    expect(levels).toContain("high");
    expect(levels).not.toContain("thinking");
    expect(levels).not.toContain("none");
  });

  it("does not regress the zai-served GLM-5.3-Flash lines", () => {
    expect(getCapabilitiesForModel("glm", "glm-5.3-flash").thinkingFormat).toBe("zai");
    const body = { reasoning_effort: "high" };
    applyThinking("openai", "glm-5.3-flash", body, "glm");
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBeUndefined();
  });
});
