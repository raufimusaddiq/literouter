import { describe, expect, it } from "bun:test";
import { vi } from "#test/vi";
import { APIKEY_PROVIDERS, supportsServiceKind } from "@/shared/constants/providers.js";
import { getModelsByProviderId } from "open-sse/config/providerModels.js";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn().mockResolvedValue({ requireApiKey: false }),
  getProviderNodes: vi.fn().mockResolvedValue([]),
  getProviderNodeById: vi.fn().mockResolvedValue(null),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn().mockReturnValue(null),
  isValidApiKey: vi.fn(),
  proxyAwareFetch: vi.fn(),
  saveUsageStats: vi.fn(),
  trackPendingRequest: vi.fn(),
}));

vi.mock("@/lib/db/index.js", async () => ({ ...(await import("@/lib/db/index.js?actual")), getSettings: mocks.getSettings, getProviderNodes: mocks.getProviderNodes, getProviderNodeById: mocks.getProviderNodeById }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.proxyAwareFetch }));
vi.mock("open-sse/handlers/chatCore/requestDetail.js", async () => {
  const actual = await import("open-sse/handlers/chatCore/requestDetail.js?actual");
  return { ...actual, saveUsageStats: mocks.saveUsageStats };
});
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: mocks.trackPendingRequest,
  statsEmitter: {},
  getActiveRequests: vi.fn(),
  saveRequestUsage: vi.fn(),
  flushUsageQueue: vi.fn(),
  getUsageStats: vi.fn(),
  getChartData: vi.fn(),
  getRecentLogs: vi.fn(),
  saveRequestDetail: vi.fn(),
  getRequestDetails: vi.fn(),
  getRequestDetailById: vi.fn(),
  flushRequestDetails: vi.fn(),
  ensureRequestDetailShutdownHandler: vi.fn()
}));

const { handleSystemOne, normalizeSystemOneRequest } = await import("@/sse/handlers/systemOne.js");

describe("System One request normalization", () => {
  it("keeps TypeSafe visible in the API-key provider catalog", () => {
    expect(APIKEY_PROVIDERS.typesafe).toBeDefined();
    expect(supportsServiceKind(APIKEY_PROVIDERS.typesafe, "systemone")).toBe(true);
  });

  it("resolves TypeSafe models from the registry model catalog", () => {
    expect(getModelsByProviderId("typesafe").map(({ id }) => id)).toEqual(["jev-latest"]);
  });
  it("accepts the native TypeSafe shape and normalizes a provider-prefixed model", async () => {
    const result = await normalizeSystemOneRequest({
      model: "typesafe/jev-latest",
      state: { message: "hello" },
      questions: { urgent: { type: "noul", instructions: "Is this urgent?" } },
    });

    expect(result.error).toBeUndefined();
    expect(result.provider).toBe("typesafe");
    expect(result.model).toBe("jev-latest");
    expect(result.body.model).toBe("jev-latest");
  });

  it("rejects empty questions before contacting upstream", async () => {
    expect((await normalizeSystemOneRequest({ model: "jev-latest", state: "hello", questions: {} })).error)
      .toBe("questions must be a non-empty object");
  });

  it("rejects models not registered for the provider", async () => {
    expect((await normalizeSystemOneRequest({
      model: "typesafe/not-a-model",
      state: "hello",
      questions: { ok: { type: "noul", instructions: "Is it okay?" } },
    })).error).toBe("Unsupported model for typesafe: not-a-model");
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
    expect(mocks.trackPendingRequest).toHaveBeenNthCalledWith(1, "jev-latest", "typesafe", "connection-1", true);
    expect(mocks.trackPendingRequest).toHaveBeenLastCalledWith("jev-latest", "typesafe", "connection-1", false);
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

describe("Cloudflare System One", () => {
  const STATE = { message: "hello" };
  const QUESTIONS = { urgent: { type: "noul", instructions: "Is this urgent?" } };
  const FIELDS = { name: { type: "string", instructions: "Customer name" } };

  it.each([
    ["@cf/cloudflare/clef", "clef", { questions: QUESTIONS }],
    ["@cf/cloudflare/clef-flash", "clef-flash", { questions: QUESTIONS }],
    ["@cf/cloudflare/clef-omni", "clef-omni", { questions: QUESTIONS }],
    ["@cf/cloudflare/clairic", "clairic", { fields: FIELDS }],
  ])("sends the short selector for %s as the body model", async (model, selector, payload) => {
    const result = await normalizeSystemOneRequest({ model: `cloudflare-ai/${model}`, state: STATE, ...payload });
    expect(result.error).toBeUndefined();
    expect(result.model).toBe(model);
    expect(result.body.model).toBe(selector);
  });

  it.each([
    ["@cf/cloudflare/clairic", { questions: QUESTIONS }, "fields must be a non-empty object"],
    ["@cf/cloudflare/clef", { fields: FIELDS }, "questions must be a non-empty object"],
  ])("validates the payload shape %s declares", async (model, payload, error) => {
    expect((await normalizeSystemOneRequest({ model: `cloudflare-ai/${model}`, state: STATE, ...payload })).error).toBe(error);
  });

  it.each([{ questions: QUESTIONS }, { fields: FIELDS }])("lets a custom node take either map (%j)", async (payload) => {
    const result = await normalizeSystemOneRequest({ model: "systemone-node/any-model", state: STATE, ...payload });
    expect(result.error).toBeUndefined();
    expect(result.body.model).toBe("any-model");
  });

  it("rejects a custom node payload with neither map", async () => {
    expect((await normalizeSystemOneRequest({ model: "systemone-node/any-model", state: STATE })).error)
      .toBe("questions or fields must be a non-empty object");
  });

  it("unwraps the result envelope, keeps the full id in the URL and records usage", async () => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.extractApiKey.mockReturnValue(null);
    mocks.saveUsageStats.mockClear();
    mocks.getProviderCredentials.mockResolvedValue({
      apiKey: "cf-token",
      connectionId: "cf-1",
      providerSpecificData: { accountId: "acct" },
    });
    const inner = { answers: { name: { value: "Ada" } }, usage: { input_tokens: 120, output_tokens: 0 } };
    mocks.proxyAwareFetch.mockResolvedValue(new Response(JSON.stringify({ result: inner, success: true, errors: [], messages: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const response = await handleSystemOne(new Request("http://localhost/v1/systemone", {
      method: "POST",
      body: JSON.stringify({ model: "cloudflare-ai/@cf/cloudflare/clairic", state: STATE, fields: FIELDS }),
      headers: { "Content-Type": "application/json" },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(inner);
    const [url, init] = mocks.proxyAwareFetch.mock.calls.at(-1);
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/cloudflare/clairic");
    expect(JSON.parse(init.body).model).toBe("clairic");
    expect(mocks.saveUsageStats).toHaveBeenCalledWith(expect.objectContaining({
      provider: "cloudflare-ai",
      model: "@cf/cloudflare/clairic",
      tokens: expect.objectContaining({ prompt_tokens: 120 }),
    }));
  });

  it.each([
    ["a top-level answers body", { answers: { a: 1 }, result: { answers: { b: 2 } } }],
    ["a result without answers", { result: { other: true } }],
  ])("leaves %s untouched", async (_label, payload) => {
    const { unwrapSystemOneEnvelope } = await import("@/sse/handlers/systemOne.js");
    expect(unwrapSystemOneEnvelope(payload, "result")).toBe(payload);
  });

  it("prices the Clef family and Clairic per input token", async () => {
    const { getPricingForModel } = await import("open-sse/providers/pricing.js");
    expect(getPricingForModel("cloudflare-ai", "@cf/cloudflare/clef-omni")).toMatchObject({ input: 0.15, output: 0 });
    expect(getPricingForModel("cloudflare-ai", "@cf/cloudflare/clairic")).toMatchObject({ input: 0.24, output: 0 });
  });
});
