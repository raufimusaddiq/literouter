import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { vi } from "#test/vi";
import { useTempDataDir } from "#test/tempDataDir";

async function setupDb() {
  const { createProviderNode } = await import("@/models/index.js");
  const { getModelInfo } = await import("@/sse/services/model.js");

  return {
    createProviderNode,
    getModelInfo,
  };
}

describe("model routing", () => {
  useTempDataDir("9router-model-routing-");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps built-in provider aliases ahead of compatible node prefixes", async () => {
    const ctx = await setupDb();

    await ctx.createProviderNode({
      id: "openai-compatible-chat-test",
      type: "openai-compatible",
      name: "Compatible CF Collision",
      prefix: "cf",
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    });

    await expect(ctx.getModelInfo("cf/@cf/black-forest-labs/flux-2-klein-9b"))
      .resolves.toEqual({
        provider: "cloudflare-ai",
        model: "@cf/black-forest-labs/flux-2-klein-9b",
      });
  });

  it("still routes non-reserved compatible node prefixes", async () => {
    const ctx = await setupDb();

    await ctx.createProviderNode({
      id: "openai-compatible-chat-test",
      type: "openai-compatible",
      name: "Compatible OCT",
      prefix: "oct",
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    });

    await expect(ctx.getModelInfo("oct/gpt-image-1"))
      .resolves.toEqual({
        provider: "openai-compatible-chat-test",
        model: "gpt-image-1",
      });
  });
});
