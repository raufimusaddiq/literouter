import { describe, expect, it } from "bun:test";

import deeprelay from "../../open-sse/providers/registry/deeprelay.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getDefaultModel, getModelSupportedFormats } from "../../open-sse/config/providerModels.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { parseModel, resolveProviderAlias } from "../../open-sse/services/model.js";

describe("deeprelay registry entry", () => {
  it("targets api.deeprelay.ai on the three verified lanes", () => {
    expect(PROVIDERS.deeprelay.transports.map((t) => t.format))
      .toEqual(["openai", "claude", "openai-responses"]);
    expect(PROVIDERS.deeprelay.format).toBe("openai");
    expect(PROVIDERS.deeprelay.baseUrl).toBe("https://api.deeprelay.ai/v1/chat/completions");
    expect(resolveTransport("deeprelay", "openai").baseUrl).toBe("https://api.deeprelay.ai/v1/chat/completions");
    expect(resolveTransport("deeprelay", "claude").baseUrl).toBe("https://api.deeprelay.ai/v1/messages");
    expect(resolveTransport("deeprelay", "openai-responses").baseUrl).toBe("https://api.deeprelay.ai/v1/responses");
    expect(deeprelay.transports.every((t) => t.auth.scheme === "bearer")).toBe(true);
  });

  it("never points at the unrelated deeprelayapi.cloud gateway", () => {
    const urls = [deeprelay.transport.baseUrl, deeprelay.transport.validateUrl, ...deeprelay.transports.map((t) => t.baseUrl)];
    expect(urls.some((u) => u.includes("deeprelayapi.cloud"))).toBe(false);
    expect(deeprelay.transport.validateUrl).toBe("https://api.deeprelay.ai/v1/models");
  });

  it("publishes the chat-capable live catalogue without duplicates", () => {
    const ids = deeprelay.models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PROVIDER_MODELS.deeprelay.length).toBe(ids.length);
    expect(getDefaultModel("deeprelay")).toBe("deepseek-v4.1-flash");
    expect(ids).toContain("deepseek-v4-pro");
    for (const id of ids) expect(id).not.toMatch(/image|t2v|seedance|seedream|flux|vidu|wan2|embedding|pixverse|happyhorse/);
    expect(deeprelay.passthroughModels).toBe(true);
  });

  it("leaves lane selection open (every lane serves every chat id)", () => {
    expect(getModelSupportedFormats("deeprelay", "deepseek-v4.1-flash")).toBeFalsy();
  });

  it("resolves thinking shape from the model family", () => {
    expect(deeprelay.transports.every((t) => t.thinkingFormat === undefined)).toBe(true);
    expect(getCapabilitiesForModel("deeprelay", "deepseek-v4.1-flash").thinkingFormat).toBe("deepseek");
  });

  it("routes the dr and relay aliases", () => {
    expect(resolveProviderAlias("dr")).toBe("deeprelay");
    expect(resolveProviderAlias("relay")).toBe("deeprelay");
    expect(parseModel("dr/deepseek-v4.1-flash")).toEqual({
      provider: "deeprelay",
      model: "deepseek-v4.1-flash",
      isAlias: false,
      providerAlias: "dr",
    });
  });
});
