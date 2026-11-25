import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { vi } from "#test/vi";

const fx = vi.hoisted(() => ({ keys: {}, spend: {}, resetsAt: null }));
const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  handleChatCore: vi.fn(),
}));

vi.mock("@/lib/db/index.js", async () => ({
  ...(await import("@/lib/db/index.js?actual")),
  getSettings: async () => ({ requireApiKey: false, comboStrategy: "fallback" }),
  getModelAliases: async () => ({}),
  getComboByName: async () => null,
  getProviderNodes: async () => [],
  getCombos: async () => [],
  getProviderConnections: async () => [],
  getProviderConnectionById: async () => null,
  getCustomModels: async () => [],
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/lib/db/repos/combosRepo.js", async () => ({ ...(await import("@/lib/db/repos/combosRepo.js?actual")), getCombos: async () => [] }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", async () => ({
  ...(await import("@/lib/db/repos/apiKeysRepo.js?actual")),
  getApiKeyByKey: async (k) => fx.keys[k] || null,
}));
vi.mock("@/lib/db/repos/keyBudgetRepo.js", async () => ({
  ...(await import("@/lib/db/repos/keyBudgetRepo.js?actual")),
  getBudgetSpend: async (keyId, period) => fx.spend[`${keyId}|${period}`] || { tokens: 0, cost: 0, resetsAt: fx.resetsAt },
}));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: vi.fn(),
  extractApiKey: (request) => {
    const a = request.headers.get("Authorization");
    return a?.startsWith("Bearer ") ? a.slice(7) : request.headers.get("x-api-key");
  },
  isValidApiKey: async () => true,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: async (_p, c) => c,
  updateProviderCredentials: vi.fn(),
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));

const { handleChat } = await import("../../src/sse/handlers/chat.js");
const geminiRoute = await import("../../src/app/api/v1beta/models/[...path]/route.js");

const enc = new TextEncoder();
const sse = (frames) => new Response(new ReadableStream({
  start(c) { for (const f of frames) c.enqueue(enc.encode(f)); c.close(); },
}), { status: 200, headers: { "Content-Type": "text/event-stream" } });

const post = (path, k) => new Request(`http://localhost${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` },
  body: JSON.stringify({ model: "openai/model-a", stream: true, max_tokens: 16, messages: [{ role: "user", content: "hi" }] }),
});

const call = (path, k) => handleChat(post(path, k));

const RESET_MS = Date.parse("2026-03-06T00:00:00.000Z");
const NOW_MS = RESET_MS - 90 * 1000;
let nowSpy;

beforeEach(() => {
  vi.clearAllMocks();
  nowSpy = vi.spyOn(Date, "now").mockReturnValue(NOW_MS);
  fx.resetsAt = new Date(RESET_MS).toISOString();
  fx.keys = {
    "sk-budget": { id: "budgeted", key: "sk-budget", name: "budgeted", isActive: true, access: { restricted: false, allow: [] }, budget: { period: "day", maxTokens: 100 }, budgetInvalid: false },
    "sk-open": { id: "open", key: "sk-open", name: "open", isActive: true, access: { restricted: false, allow: [] }, budget: null, budgetInvalid: false },
    "sk-broken": { id: "broken", key: "sk-broken", name: "broken", isActive: true, access: { restricted: false, allow: [] }, budget: null, budgetInvalid: true },
  };
  fx.spend = { "budgeted|day": { tokens: 100, cost: 0.4, resetsAt: fx.resetsAt } };
  mocks.getProviderCredentials.mockResolvedValue({ connectionId: "conn", connectionName: "mock" });
  mocks.handleChatCore.mockImplementation(async () => ({ success: true, response: sse([`data: [DONE]\n\n`]) }));
});

afterEach(() => nowSpy.mockRestore());

describe("key budget refusal", () => {
  it.each(["/v1/chat/completions", "/v1/responses"])("refuses %p with 429 and an insufficient_quota error", async (path) => {
    const response = await call(path, "sk-budget");
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.type).toBe("insufficient_quota");
    expect(body.error.message).toContain("daily tokens budget of 100");
  });

  it("sends Retry-After as the exact seconds until the window resets", async () => {
    const response = await call("/v1/chat/completions", "sk-budget");
    expect(response.headers.get("retry-after")).toBe("90");
  });

  it("never puts the key value in the refusal", async () => {
    const body = await (await call("/v1/chat/completions", "sk-budget")).json();
    expect(JSON.stringify(body)).not.toContain("sk-budget");
  });

  it("comes out Anthropic-shaped on /v1/messages", async () => {
    const response = await call("/v1/messages", "sk-budget");
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("rate_limit_error");
    expect(response.headers.get("retry-after")).toBe("90");
  });

  it("comes out Gemini-shaped on the Gemini-native TTS path", async () => {
    const response = await geminiRoute.POST(
      new Request("http://localhost/v1beta/models/gemini-2.5-flash-preview-tts:generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer sk-budget" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "x" }] }], generationConfig: { responseModalities: ["AUDIO"] } }),
      }),
      { params: Promise.resolve({ path: ["gemini-2.5-flash-preview-tts:generateContent"] }) },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("90");
    const body = await response.json();
    expect(body.error.code).toBe(429);
    expect(body.error.status).toBe("RESOURCE_EXHAUSTED");
    expect(body.error.message).toContain("daily tokens budget of 100");
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });

  it("refuses before credential lookup without locking or rotating an account", async () => {
    await call("/v1/chat/completions", "sk-budget");
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("refuses a key whose stored budget no longer parses, instead of reading it as unlimited", async () => {
    const response = await call("/v1/chat/completions", "sk-broken");
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.message).toContain("invalid budget stored");
    expect(body.error.message).toContain("re-save");
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("serves an unbudgeted key exactly as before", async () => {
    expect((await call("/v1/chat/completions", "sk-open")).status).toBe(200);
    expect(mocks.handleChatCore).toHaveBeenCalled();
  });

  it("serves a budgeted key that is still under its limit", async () => {
    fx.spend["budgeted|day"] = { tokens: 99, cost: 0.1, resetsAt: fx.resetsAt };
    expect((await call("/v1/chat/completions", "sk-budget")).status).toBe(200);
  });

  it("refuses on the cost limit too", async () => {
    fx.keys["sk-budget"].budget = { period: "month", maxCost: 2 };
    fx.spend["budgeted|month"] = { tokens: 10, cost: 2, resetsAt: fx.resetsAt };
    const body = await (await call("/v1/chat/completions", "sk-budget")).json();
    expect(body.error.message).toContain("monthly cost budget of $2");
  });
});
