import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import kenari from "../../open-sse/providers/registry/kenari.js";
import { getKenariUsage } from "../../open-sse/services/usage/kenari.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("kenari native provider", () => {
  it("keeps id unique after adding the provider", () => {
    const ids = REGISTRY.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is registered with the kn alias", () => {
    expect(REGISTRY.some((r) => r.id === "kenari")).toBe(true);
    expect(kenari.alias).toBe("kenari");
    expect(kenari.aliases).toContain("kn");
  });

  it("exposes chat, responses, and claude transports", () => {
    const formats = kenari.transports.map((t) => t.format).sort();
    expect(formats).toEqual(["claude", "openai", "openai-responses"]);
  });

  it("routes DeepSeek models through Chat Completions", () => {
    expect(kenari.models.find((model) => model.id === "deepseek-v4-1-flash").supportedFormats).toEqual(["openai"]);
  });

  it("folds Responses system instructions into the first user turn", () => {
    const body = new DefaultExecutor("kenari").transformRequest("deepseek-v4-1-flash", {
      instructions: "be concise",
      input: [
        { type: "message", role: "system", content: [{ type: "input_text", text: "follow policy" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "Reply OK" }] },
      ],
    });
    expect(body.instructions).toBeUndefined();
    expect(body.input.every((item) => item.role !== "system")).toBe(true);
    expect(body.input[0].content[0].text).toContain("be concise");
    expect(body.input[0].content[0].text).toContain("follow policy");
  });

  it("advertises usage for apikey connections", () => {
    expect(kenari.features?.usage).toBe(true);
    expect(kenari.features?.usageApikey).toBe(true);
    expect(kenari.transport?.usage?.url).toContain("/v1/account/quota");
  });

  it("has a non-empty model catalog", () => {
    expect(kenari.models.length).toBeGreaterThan(0);
  });

  it("is whitelisted for apikey usage lookups", () => {
    // Mirrors src/shared/constants/providers.js derivation from registry flags.
    expect(REGISTRY.filter((r) => r.features?.usage).map((r) => r.id)).toContain("kenari");
    expect(REGISTRY.filter((r) => r.features?.usageApikey).map((r) => r.id)).toContain("kenari");
  });
});

describe("kenari usage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps the IDR plan windows to quota rows", async () => {
    proxyAwareFetch.mockResolvedValue(new Response(JSON.stringify({
      coupon: null,
      plan: {
        name: "Kreator",
        windows: {
          month: { remaining_rp: 589088, used_rp: 10912, resets_at: "2026-10-15T15:41:39Z" },
          week: { remaining_rp: 139088, used_rp: 10912, resets_at: "2026-09-22T15:41:39Z" },
        },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const usage = await getKenariUsage("kn-test");

    expect(usage.plan).toBe("Kreator");
    expect(usage.quotas["Monthly (IDR)"]).toMatchObject({ used: 10912, total: 600000, remainingPercentage: 98 });
    expect(usage.quotas["Weekly (IDR)"].resetAt).toBe("2026-09-22T15:41:39Z");
  });
});
