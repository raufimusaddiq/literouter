import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => "{}",
  })),
}));

const load = () => import("../../open-sse/services/usage.js");
const SUPPORTED = [
  "github", "gemini-cli", "antigravity", "claude", "codex", "kiro",
  "qoder", "iflow", "ollama", "glm", "glm-cn",
  "minimax", "minimax-cn", "vercel-ai-gateway", "grok-cli", "kimi",
  "deepseek", "opencode-go", "zed", "commandcode", "synthetic",
];

describe("usage dispatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unsupported provider → not-implemented message", async () => {
    const { getUsageForProvider } = await load();
    const res = await getUsageForProvider({ provider: "totally-unknown" });
    expect(res).toEqual({ message: "Usage API not implemented for totally-unknown" });
  });

  it("every supported provider routes to its handler (no fallback message)", async () => {
    const { getUsageForProvider } = await load();
    for (const provider of SUPPORTED) {
      const res = await getUsageForProvider({ provider, accessToken: "t", apiKey: "k" });
      expect(res, `${provider} routed`).toBeTypeOf("object");
      expect(res?.message).not.toBe(`Usage API not implemented for ${provider}`);
    }
  });
});
