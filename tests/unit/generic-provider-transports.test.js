import { describe, expect, it } from "vitest";
import { nodeRoutes } from "../../src/shared/constants/compatibleNodeRoutes.js";
import { resolveTransport } from "../../open-sse/services/provider.js";

describe("Generic Provider native transports", () => {
  it("derives all three routes", () => {
    expect(nodeRoutes({
      type: "openai-compatible",
      baseUrl: "https://up.example/v1/",
      transports: ["chat_completions", "responses", "messages"],
    })).toEqual([
      { transport: "chat_completions", format: "openai", path: "/chat/completions", baseUrl: "https://up.example/v1" },
      { transport: "responses", format: "openai-responses", path: "/responses", baseUrl: "https://up.example/v1" },
      { transport: "messages", format: "claude", path: "/messages", baseUrl: "https://up.example/v1" },
    ]);
  });

  it("selects native route and rejects unsupported format", () => {
    const credentials = { providerSpecificData: {
      baseUrl: "https://up.example/v1",
      transports: ["chat_completions", "responses", "messages"],
    } };
    expect(resolveTransport("openai-compatible-chat-id", "openai-responses", credentials).baseUrl).toBe("https://up.example/v1/responses");
    expect(resolveTransport("openai-compatible-chat-id", "claude", credentials).baseUrl).toBe("https://up.example/v1/messages");
    expect(resolveTransport("openai-compatible-chat-id", "gemini", credentials)).toBeNull();
  });
});
