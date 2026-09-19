import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleChat: vi.fn(), getSettings: vi.fn(), isValidApiKey: vi.fn(),
  getProviderCredentials: vi.fn(), markAccountUnavailable: vi.fn(), clearAccountError: vi.fn(),
}));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials, isValidApiKey: mocks.isValidApiKey,
  markAccountUnavailable: mocks.markAccountUnavailable, clearAccountError: mocks.clearAccountError,
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));

import { GET, OPTIONS } from "../../src/app/api/v1beta/models/route.js";
import { POST } from "../../src/app/api/v1beta/models/[...path]/route.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";

function audioBody() {
  return { contents: [{ parts: [{ text: "hello" }] }], generationConfig: { responseModalities: ["AUDIO"] } };
}

function request(model, body = audioBody(), headers = {}) {
  return new Request(`https://router.test/v1beta/models/${model}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer router-client-key", ...headers }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ requireApiKey: true });
  mocks.isValidApiKey.mockResolvedValue(true);
  mocks.getProviderCredentials.mockResolvedValue({ apiKey: "real-gemini-key", connectionId: "gemini-conn", providerSpecificData: {} });
  mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });
  mocks.handleChat.mockResolvedValue(Response.json({ candidates: [] }));
  global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
});

// The old suite here asserted TTS model names that the route no longer serves
// (ttsModels.js is a separate table). This asserts the live contract: every
// provider model is listed under models/<provider>/<id>, and gemini models also
// get the bare models/<id> alias Gemini clients call.
describe("Gemini native v1beta models endpoint", () => {
  it("answers CORS preflight", async () => {
    const res = await OPTIONS();
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("lists provider-qualified and bare gemini model names", async () => {
    const { models } = await (await GET()).json();
    const names = models.map((model) => model.name);

    const [provider, list] = Object.entries(PROVIDER_MODELS)[0];
    expect(names).toContain(`models/${provider}/${list[0].id}`);

    for (const model of PROVIDER_MODELS.gemini) {
      expect(names).toContain(`models/gemini/${model.id}`);
      expect(names).toContain(`models/${model.id}`);
    }
  });

  it("de-duplicates names and reports generation methods", async () => {
    const { models } = await (await GET()).json();
    const names = models.map((model) => model.name);
    expect(new Set(names).size).toBe(names.length);
    for (const model of models) {
      expect(model.supportedGenerationMethods).toContain("generateContent");
    }
  });
});

describe("Gemini native v1beta request forwarding", () => {
  const tts = "gemini-3.1-flash-tts-preview:generateContent";
  const params = { params: Promise.resolve({ path: [tts] }) };

  it("forwards audio requests with the selected credential", async () => {
    const body = audioBody();
    const response = await POST(request(tts, body), params);

    expect(response.status).toBe(200);
    expect(mocks.handleChat).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent",
      expect.objectContaining({ method: "POST", body: JSON.stringify(body), headers: expect.objectContaining({ "x-goog-api-key": "real-gemini-key" }) })
    );
  });

  it("validates, but never forwards, a client Google API key", async () => {
    await POST(request(tts, audioBody(), { Authorization: "", "x-goog-api-key": "client-router-key" }), params);

    expect(mocks.isValidApiKey).toHaveBeenCalledWith("client-router-key");
    expect(global.fetch.mock.calls[0][1].headers["x-goog-api-key"]).toBe("real-gemini-key");
  });

  it("strips stale compression headers from native responses", async () => {
    global.fetch.mockResolvedValueOnce(new Response("{}", { status: 200, headers: { "content-encoding": "gzip", "content-length": "2" } }));
    const response = await POST(request(tts), params);

    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
  });

  it("falls back to the next credential after a native timeout", async () => {
    const timeout = new TypeError("fetch failed");
    timeout.cause = { code: "UND_ERR_HEADERS_TIMEOUT" };
    mocks.getProviderCredentials
      .mockResolvedValueOnce({ apiKey: "first-key", connectionId: "first", providerSpecificData: {} })
      .mockResolvedValueOnce({ apiKey: "second-key", connectionId: "second", providerSpecificData: {} });
    mocks.markAccountUnavailable.mockResolvedValueOnce({ shouldFallback: true });
    global.fetch.mockRejectedValueOnce(timeout).mockResolvedValueOnce(new Response("{}", { status: 200 }));

    expect((await POST(request(tts), params)).status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls.map(([, options]) => options.headers["x-goog-api-key"])).toEqual(["first-key", "second-key"]);
  });
});
