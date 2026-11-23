import { beforeEach, describe, expect, it, vi } from "vitest";

describe("proxy dispatcher LRU", () => {
  const closed = [];
  beforeEach(() => { closed.length = 0; vi.resetModules(); });

  it("evicts the least-recently-used dispatcher, not the oldest-inserted", async () => {
    vi.doMock("undici", async (orig) => {
      const actual = await orig();
      class ProxyAgent {
        constructor(o) { this.uri = o.uri; }
        async close() { closed.push(this.uri); }
      }
      return { ...actual, ProxyAgent };
    });
    const { MEMORY_CONFIG } = await import("../../open-sse/config/runtimeConfig.js");
    const { getDispatcher } = await import("../../open-sse/utils/proxyFetch.js");
    const max = MEMORY_CONFIG.proxyDispatchersMaxSize;
    expect(max).toBeGreaterThanOrEqual(64);
    for (let i = 0; i < max; i++) await getDispatcher(`http://127.0.0.1:${9000 + i}`);
    const first = await getDispatcher("http://127.0.0.1:9000");
    expect(await getDispatcher("http://127.0.0.1:9000")).toBe(first);
    await getDispatcher("http://127.0.0.1:19999");
    expect(closed).toEqual(["http://127.0.0.1:9001"]);
    vi.doUnmock("undici");
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
    vi.doMock("node:crypto", () => ({ createHash: () => { throw new Error("nope"); } }));
    try {
      const rtk = await import("../../open-sse/rtk/index.js");
      const body = mkBody(bigDiff());
      expect(() => rtk.compressMessages(body, true)).not.toThrow();
      expect(body.messages[0].content.length).toBeLessThan(bigDiff().length);
    } finally { vi.doUnmock("node:crypto"); vi.resetModules(); }
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
    vi.doMock("@/lib/db/driver.js", () => ({ getAdapter: vi.fn(async () => db), getAdapterSync: vi.fn(() => db) }));
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
