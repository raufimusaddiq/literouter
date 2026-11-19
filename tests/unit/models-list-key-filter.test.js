import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ ctx: null }));
vi.mock("@/sse/services/keyAccess.js", () => ({
  getKeyAccessContext: vi.fn(async () => mocks.ctx),
  filterModelsListForKey: vi.fn(async (ctx, list) => list.filter((e) => ctx.allow.includes(e.id))),
}));

const beta = await import("../../src/app/api/v1beta/models/route.js");
const info = await import("../../src/app/api/v1/models/info/route.js");

describe("model catalogs honour restricted keys", () => {
  beforeEach(() => { mocks.ctx = null; });

  it("v1beta/models: unrestricted sees everything, restricted only its allow list", async () => {
    const all = (await (await beta.GET(new Request("http://x/v1beta/models"))).json()).models;
    expect(all.length).toBeGreaterThan(1);
    const target = all[0].name.replace(/^models\//, "");
    mocks.ctx = { allow: [target] };
    const some = (await (await beta.GET(new Request("http://x/v1beta/models"))).json()).models;
    expect(some.length).toBeGreaterThan(0);
    expect(some.length).toBeLessThan(all.length);
    expect(some.every((m) => m.name.replace(/^models\//, "") === target)).toBe(true);
  });

  it("v1/models/info: restricted key gets 404 for a model it cannot call", async () => {
    const { PROVIDER_MODELS } = await import("open-sse/config/providerModels.js");
    const [alias, list] = Object.entries(PROVIDER_MODELS).find(([, l]) => l.some((m) => !m.kind || m.kind === "llm"));
    const id = `${alias}/${list.find((m) => !m.kind || m.kind === "llm").id}`;
    const url = `http://x/v1/models/info?id=${encodeURIComponent(id)}`;
    expect((await info.GET(new Request(url))).status).toBe(200);
    mocks.ctx = { allow: [] };
    expect((await info.GET(new Request(url))).status).toBe(404);
    mocks.ctx = { allow: [id] };
    expect((await info.GET(new Request(url))).status).toBe(200);
  });
});
