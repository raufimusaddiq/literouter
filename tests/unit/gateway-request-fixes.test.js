import { describe, it, expect, beforeEach } from "bun:test";
import { vi } from "#test/vi";

const fx = vi.hoisted(() => ({ combos: [] }));

vi.mock("@/lib/db/index.js", async () => ({
  ...(await import("../../src/lib/db/index.js?actual")),
  getSettings: async () => ({ requireApiKey: false, comboStrategy: "fallback" }),
  getModelAliases: async () => ({}),
  getComboByName: async (name) => fx.combos.find((c) => c.name === name) || null,
  getProviderNodes: async () => [],
  getCombos: async () => fx.combos,
  getProviderConnections: async () => [],
  getProviderConnectionById: async () => null,
  getCustomModels: async () => [],
  validateApiKey: async () => true,
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/lib/db/repos/combosRepo.js", async () => ({ ...(await import("../../src/lib/db/repos/combosRepo.js?actual")), getCombos: async () => fx.combos }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", async () => ({ ...(await import("../../src/lib/db/repos/apiKeysRepo.js?actual")), getApiKeyByKey: async () => null }));
vi.mock("@/lib/usageDb.js", async () => ({ ...(await import("../../src/lib/usageDb.js?actual")), saveRequestUsage: vi.fn() }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: async (_p, c) => c,
  updateProviderCredentials: vi.fn(),
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: vi.fn() }));

const { extractApiKey } = await import("../../src/sse/services/auth.js");
const { validateCombo } = await import("../../src/app/api/combos/validate.js");
const { handleChat } = await import("../../src/sse/handlers/chat.js");
const geminiRoute = await import("../../src/app/api/v1beta/models/[...path]/route.js");

const req = (headers = {}, url = "http://localhost/v1/chat/completions") =>
  new Request(url, { headers });

beforeEach(() => {
  fx.combos = [];
});

describe("extractApiKey", () => {
  it("reads x-goog-api-key and ?key= like keyAccess does", () => {
    expect(extractApiKey(req({ "x-goog-api-key": "g-key" }))).toBe("g-key");
    expect(extractApiKey(req({}, "http://localhost/v1beta/models/x:generateContent?key=q-key"))).toBe("q-key");
  });

  it("keeps Bearer first, then x-api-key", () => {
    expect(extractApiKey(req({ Authorization: "Bearer b-key", "x-api-key": "a-key" }))).toBe("b-key");
    expect(extractApiKey(req({ "x-api-key": "a-key" }))).toBe("a-key");
    expect(extractApiKey(req())).toBeNull();
  });
});

describe("validateCombo", () => {
  it("rejects a self reference", async () => {
    expect(await validateCombo({ name: "a", models: ["a"] })).toMatch(/itself/);
  });

  it("rejects a mutual reference through an existing combo", async () => {
    fx.combos = [{ id: "b", name: "b", models: ["a"] }];
    expect(await validateCombo({ name: "a", models: ["b"] })).toMatch(/through "b"/);
  });

  it("accepts a nested combo that does not close a cycle", async () => {
    fx.combos = [{ id: "b", name: "b", models: ["openai/x"] }];
    expect(await validateCombo({ name: "a", models: ["b"] })).toBeNull();
  });

  it("rejects a models field that is not a string array", async () => {
    expect(await validateCombo({ name: "a", models: "openai/x" })).toMatch(/array of strings/);
    expect(await validateCombo({ name: "a", models: [1] })).toMatch(/array of strings/);
  });
});

describe("chat combo cycle guard", () => {
  it("fails fast with 400 instead of expanding a stored cycle", async () => {
    fx.combos = [
      { id: "a", name: "a", models: ["b"] },
      { id: "b", name: "b", models: ["a"] },
    ];
    const res = await handleChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "a", messages: [{ role: "user", content: "hi" }] }),
    }));
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/cycle/i);
  });
});

describe("v1beta bad JSON", () => {
  it("returns 400 for a malformed body", async () => {
    const res = await geminiRoute.POST(new Request(
      "http://localhost/v1beta/models/gemini:generateContent",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" }
    ), { params: Promise.resolve({ path: ["gemini:generateContent"] }) });
    expect(res.status).toBe(400);
  });
});
