import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ get: vi.fn(), all: vi.fn(), run: vi.fn(), transaction: vi.fn() }));
vi.mock("../../src/lib/db/driver.js", () => ({ getAdapter: async () => db }));

const { deleteProxyPool } = await import("../../src/lib/db/repos/proxyPoolsRepo.js");

beforeEach(() => {
  vi.clearAllMocks();
  db.transaction.mockImplementation((callback) => callback());
  db.get.mockImplementation((sql) => sql.includes("proxyPools")
    ? { id: "p1", isActive: 1, data: JSON.stringify({ strictProxy: false }) }
    : { data: "{}" });
  db.all.mockReturnValue([]);
});

describe("proxy pool deletion reference integrity", () => {
  it("rejects a connection reference inside the delete transaction", async () => {
    db.all.mockReturnValue([{ data: JSON.stringify({ providerSpecificData: { proxyPoolId: " p1 " } }) }]);
    await expect(deleteProxyPool("p1")).rejects.toMatchObject({ code: "PROXY_POOL_IN_USE" });
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.run).not.toHaveBeenCalled();
  });

  it.each([false, true])("rejects a provider strategy reference for strictProxy=%s", async (strictProxy) => {
    db.get.mockImplementation((sql) => sql.includes("proxyPools")
      ? { id: "p1", isActive: 1, data: JSON.stringify({ strictProxy }) }
      : { data: JSON.stringify({ providerStrategies: { opencode: { proxyPoolId: "p1" } } }) });
    await expect(deleteProxyPool("p1")).rejects.toMatchObject({ code: "PROXY_POOL_IN_USE" });
    expect(db.run).not.toHaveBeenCalled();
  });

  it("deletes an unreferenced pool", async () => {
    await expect(deleteProxyPool("p1")).resolves.toMatchObject({ id: "p1" });
    expect(db.run).toHaveBeenCalledWith("DELETE FROM proxyPools WHERE id = ?", ["p1"]);
  });

  it("does not delete on a reference lookup failure", async () => {
    db.all.mockImplementation(() => { throw new Error("DB unavailable"); });
    await expect(deleteProxyPool("p1")).rejects.toThrow("DB unavailable");
    expect(db.run).not.toHaveBeenCalled();
  });
});
