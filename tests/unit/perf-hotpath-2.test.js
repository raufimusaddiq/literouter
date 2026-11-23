import { beforeEach, describe, expect, it } from "bun:test";
import { vi } from "#test/vi";

const realCrypto = { ...(await import("node:crypto")) };

describe("proxy URL handling", () => {
  beforeEach(() => { vi.resetModules(); });

  it("adds http:// to a bare host:port and leaves full URLs unchanged", async () => {
    for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) vi.stubEnv(name, "");
    const realFetch = globalThis.fetch;
    const seen = [];
    globalThis.fetch = vi.fn(async (_u, o) => { seen.push(o.proxy); return new Response("ok"); });
    try {
      const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
      await proxyAwareFetch("https://example.invalid/x", {}, { enabled: true, url: "127.0.0.1:9000" });
      await proxyAwareFetch("https://example.invalid/x", {}, { enabled: true, url: "http://user:pw@127.0.0.1:9001" });
      await proxyAwareFetch("https://example.invalid/x", {}, null);
      expect(seen).toEqual(["http://127.0.0.1:9000", "http://user:pw@127.0.0.1:9001", undefined]);
    } finally { globalThis.fetch = realFetch; vi.unstubAllEnvs(); }
  });
});

describe("RTK memo", () => {
  const bigDiff = () => {
    const lines = ["diff --git a/f b/f", "index 1..2 100644", "--- a/f", "+++ b/f"];
    for (let h = 0; h < 40; h++) {
      lines.push(`@@ -${h},6 +${h},6 @@`);
      for (let k = 0; k < 8; k++) lines.push(` context line ${h}-${k} ${"x".repeat(30)}`);
      lines.push(`-old ${h}`, `+new ${h}`);
    }
    return lines.join("\n");
  };
  const mkBody = (text) => ({ messages: [{ role: "tool", tool_call_id: "1", content: text }] });

  it("re-uses compressed output for unchanged tool_results and stays correct", async () => {
    const rtk = await import("../../open-sse/rtk/index.js");
    rtk.clearRtkMemo();
    const text = bigDiff();
    const a = mkBody(text); const sa = rtk.compressMessages(a, true);
    const b = mkBody(text); const sb = rtk.compressMessages(b, true);
    expect(rtk.rtkMemoStats.misses).toBe(1);
    expect(rtk.rtkMemoStats.hits).toBe(1);
    expect(b.messages[0].content).toBe(a.messages[0].content);
    expect(sb.bytesAfter).toBe(sa.bytesAfter);
    expect(sb.hits).toEqual(sa.hits);
  });

  it("memoizes 'no change' results too and leaves small/uncompressible text untouched", async () => {
    const rtk = await import("../../open-sse/rtk/index.js");
    rtk.clearRtkMemo();
    const plain = "hello world ".repeat(10);
    const body = mkBody(plain);
    rtk.compressMessages(body, true);
    expect(body.messages[0].content).toBe(plain);
  });

  it("is fail-open when hashing throws", async () => {
    vi.resetModules();
    vi.mock("node:crypto", () => ({ ...realCrypto, default: { ...realCrypto }, createHash: () => { throw new Error("nope"); } }));
    try {
      const rtk = await import("../../open-sse/rtk/index.js");
      const body = mkBody(bigDiff());
      expect(() => rtk.compressMessages(body, true)).not.toThrow();
      expect(body.messages[0].content.length).toBeLessThan(bigDiff().length);
    } finally { vi.mock("node:crypto", () => ({ ...realCrypto, default: realCrypto })); vi.resetModules(); }
  });
});

describe("connection snapshot index", () => {
  const rows = new Map();
  const db = {
    transaction: (fn) => fn(),
    all: vi.fn((sql) => (/FROM providerConnections/.test(sql) ? [...rows.values()] : [])),
    get: vi.fn((sql, params) => (/WHERE id = ?/.test(sql) ? rows.get(params[0]) || null : null)),
    run: vi.fn((sql, params) => {
      if (/INSERT INTO providerConnections/.test(sql)) {
        const [id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt] = params;
        rows.set(id, { id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt });
      }
      return { changes: 1 };
    }),
  };
  let repo;
  const seed = (id, provider, priority, isActive = 1) => rows.set(id, {
    id, provider, authType: "apikey", name: id, email: null, priority, isActive,
    data: "{}", createdAt: "t", updatedAt: "t",
  });

  beforeEach(async () => {
    vi.resetModules();
    vi.mock("@/lib/db/driver.js", () => ({ getAdapter: vi.fn(async () => db), getAdapterSync: vi.fn(() => db) }));
    global.__liteRouterConnectionCache = { rows: null, expiresAt: 0, versionCheckedAt: 0 };
    rows.clear(); db.all.mockClear();
    repo = await import("@/lib/db/repos/connectionsRepo.js");
  });

  it("returns the same order as filter + stable priority sort", async () => {
    seed("c", "openai", 2); seed("a", "openai", 1); seed("z", "claude", 1);
    seed("b", "openai", 2); seed("d", "openai", 0); seed("off", "openai", 1, 0);
    const expected = [...rows.values()]
      .filter((r) => r.provider === "openai" && r.isActive === 1)
      .sort((x, y) => (x.priority || 999) - (y.priority || 999)).map((r) => r.id);
    const got = await repo.getProviderConnections({ provider: "openai", isActive: true }, { clone: false });
    expect(got.map((c) => c.id)).toEqual(expected);
    const inactive = await repo.getProviderConnections({ provider: "openai", isActive: false }, { clone: false });
    expect(inactive.map((c) => c.id)).toEqual(["off"]);
    const all = await repo.getProviderConnections({}, { clone: false });
    expect(all).toHaveLength(6);
  });

  it("getProviderConnectionById uses the index and sees patched rows", async () => {
    seed("a", "openai", 1); seed("b", "openai", 2);
    expect((await repo.getProviderConnectionById("b")).id).toBe("b");
    expect(await repo.getProviderConnectionById("nope")).toBeNull();
    await repo.updateProviderConnection("b", { testStatus: "error" });
    expect((await repo.getProviderConnectionById("b")).testStatus).toBe("error");
    const list = await repo.getProviderConnections({ provider: "openai" }, { clone: false });
    expect(list.find((c) => c.id === "b").testStatus).toBe("error");
  });

  it("single-flights concurrent reloads", async () => {
    seed("a", "openai", 1);
    await Promise.all(Array.from({ length: 10 }, () => repo.getProviderConnections({ provider: "openai" })));
    expect(db.all.mock.calls.filter(([s]) => /FROM providerConnections/.test(s))).toHaveLength(1);
  });
});
