import { describe, expect, it, vi } from "vitest";
import { APIKEY_PROVIDERS, supportsServiceKind } from "@/shared/constants/providers.js";
import { getModelsByProviderId } from "open-sse/config/providerModels.js";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn().mockResolvedValue({ requireApiKey: false }),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn().mockReturnValue(null),
  isValidApiKey: vi.fn(),
  proxyAwareFetch: vi.fn(),
  saveUsageStats: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.proxyAwareFetch }));
vi.mock("open-sse/handlers/chatCore/requestDetail.js", async () => {
  const actual = await vi.importActual("open-sse/handlers/chatCore/requestDetail.js");
  return { ...actual, saveUsageStats: mocks.saveUsageStats };
});

const { handleSystemOne, normalizeSystemOneRequest } = await import("@/sse/handlers/systemOne.js");

describe("System One request normalization", () => {
  it("keeps TypeSafe visible in the API-key provider catalog", () => {
    expect(APIKEY_PROVIDERS.typesafe).toBeDefined();
    expect(supportsServiceKind(APIKEY_PROVIDERS.typesafe, "systemone")).toBe(true);
  });

  it("resolves TypeSafe models from the registry model catalog", () => {
    expect(getModelsByProviderId("typesafe").map(({ id }) => id)).toEqual(["jev-latest"]);
  });
  it("accepts the native TypeSafe shape and normalizes a provider-prefixed model", () => {
    const result = normalizeSystemOneRequest({
      model: "typesafe/jev-latest",
      state: { message: "hello" },
      questions: { urgent: { type: "noul", instructions: "Is this urgent?" } },
    });

    expect(result.error).toBeUndefined();
    expect(result.provider).toBe("typesafe");
    expect(result.model).toBe("jev-latest");
    expect(result.body.model).toBe("jev-latest");
  });

  it("rejects empty questions before contacting upstream", () => {
    expect(normalizeSystemOneRequest({ model: "jev-latest", state: "hello", questions: {} }).error)
      .toBe("questions must be a non-empty object");
  });

  it("rejects models not registered for the provider", () => {
    expect(normalizeSystemOneRequest({
      model: "typesafe/not-a-model",
      state: "hello",
      questions: { ok: { type: "noul", instructions: "Is it okay?" } },
    }).error).toBe("Unsupported model for typesafe: not-a-model");
  });
});

describe("System One pass-through", () => {
  it("forwards the native body and returns the upstream response", async () => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
    mocks.extractApiKey.mockReturnValue("router-key");
    mocks.isValidApiKey.mockResolvedValue(true);
    mocks.getProviderCredentials.mockResolvedValue({
      apiKey: "typesafe-key",
      connectionId: "connection-1",
      providerSpecificData: {},
    });
    mocks.proxyAwareFetch.mockResolvedValue(new Response('{"answers":{"urgent":{"noul":0.9}},"usage":{"input_tokens":318,"output_tokens":34}}', {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Request-Id": "req-1", "X-Provider-Latency": "12" },
    }));

    const body = {
      model: "jev-latest",
      state: "The customer needs help.",
      questions: { urgent: { type: "noul", instructions: "Is this urgent?" } },
    };
    const response = await handleSystemOne(new Request("http://localhost/v1/systemone", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"answers":{"urgent":{"noul":0.9}},"usage":{"input_tokens":318,"output_tokens":34}}');
    expect(response.headers.get("x-provider-latency")).toBe("12");
    await vi.waitFor(() => expect(mocks.saveUsageStats).toHaveBeenCalledWith({
        provider: "typesafe",
        model: "jev-latest",
        tokens: { prompt_tokens: 318, completion_tokens: 34, cached_tokens: undefined, cache_read_input_tokens: undefined, cache_creation_input_tokens: undefined },
        connectionId: "connection-1",
        apiKey: "router-key",
        endpoint: "/v1/systemone",
        silent: true,
      }));
    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      "https://api.typesafe.ai/v1/systemone",
      expect.objectContaining({
        headers: { "Content-Type": "application/json", Authorization: "Bearer typesafe-key" },
        body: JSON.stringify(body),
      }),
      {},
    );
  });

  it("uses the public Jev pricing", async () => {
    const { calculateCostFromTokens, getPricingForModel } = await import("open-sse/providers/pricing.js");
    const pricing = getPricingForModel("typesafe", "jev-latest");
    expect(pricing).toMatchObject({ input: 0.042, output: 0 });
    expect(calculateCostFromTokens({ prompt_tokens: 318, completion_tokens: 34 }, pricing)).toBeCloseTo(318 * 0.042 / 1_000_000);
  });
});
