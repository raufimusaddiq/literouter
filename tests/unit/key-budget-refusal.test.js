import { describe, it, expect, beforeEach } from "bun:test";
import { vi } from "#test/vi";

const fx = vi.hoisted(() => ({ keys: {}, spend: {} }));
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
  getBudgetSpend: async (keyId, period) => fx.spend[`${keyId}|${period}`] || { tokens: 0, cost: 0, resetsAt: "2026-03-06T00:00:00.000Z" },
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

beforeEach(() => {
  vi.clearAllMocks();
  fx.keys = {
    "sk-budget": { id: "budgeted", key: "sk-budget", name: "budgeted", isActive: true, access: { restricted: false, allow: [] }, budget: { period: "day", maxTokens: 100 } },
    "sk-open": { id: "open", key: "sk-open", name: "open", isActive: true, access: { restricted: false, allow: [] }, budget: null },
  };
  fx.spend = { "budgeted|day": { tokens: 100, cost: 0.4, resetsAt: "2026-03-06T00:00:00.000Z" } };
  mocks.getProviderCredentials.mockResolvedValue({ connectionId: "conn", connectionName: "mock" });
  mocks.handleChatCore.mockImplementation(async () => ({ success: true, response: sse([`data: [DONE]\n\n`]) }));
});

describe("key budget refusal", () => {
  it.each(["/v1/chat/completions", "/v1/responses"])("refuses %p with 429 and an insufficient_quota error", async (path) => {
    const response = await call(path, "sk-budget");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toMatch(/^\d+$/);
    const body = await response.json();
    expect(body.error.type).toBe("insufficient_quota");
    expect(body.error.message).toContain("daily tokens budget of 100");
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
    expect(response.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  it("refuses before credential lookup without locking or rotating an account", async () => {
    await call("/v1/chat/completions", "sk-budget");
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("serves an unbudgeted key exactly as before", async () => {
    expect((await call("/v1/chat/completions", "sk-open")).status).toBe(200);
    expect(mocks.handleChatCore).toHaveBeenCalled();
  });

  it("serves a budgeted key that is still under its limit", async () => {
    fx.spend["budgeted|day"] = { tokens: 99, cost: 0.1, resetsAt: "2026-03-06T00:00:00.000Z" };
    expect((await call("/v1/chat/completions", "sk-budget")).status).toBe(200);
  });

  it("refuses on the cost limit too", async () => {
    fx.keys["sk-budget"].budget = { period: "month", maxCost: 2 };
    fx.spend["budgeted|month"] = { tokens: 10, cost: 2, resetsAt: "2026-04-01T00:00:00.000Z" };
    const body = await (await call("/v1/chat/completions", "sk-budget")).json();
    expect(body.error.message).toContain("monthly cost budget of $2");
  });
});
