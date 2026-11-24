import { describe, it, expect, beforeAll } from "bun:test";
import { vi } from "#test/vi";
import { useTempDataDirAtLoad } from "#test/tempDataDir";

let repo;

useTempDataDirAtLoad("9router-connindex-");

beforeAll(async () => {
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  repo = await import("@/lib/db/repos/connectionsRepo.js");
});

describe("connection index vs optimistic patch", () => {
  it("lock patched before the first await is visible to the very next indexed read", async () => {
    const a = await repo.createProviderConnection({ provider: "openai", authType: "apikey", name: "a", apiKey: "k1", isActive: true });
    await repo.createProviderConnection({ provider: "openai", authType: "apikey", name: "b", apiKey: "k2", isActive: true });
    await repo.getProviderConnections({ provider: "openai", isActive: true }, { clone: false });
    await repo.getProviderConnectionById(a.id);

    const until = new Date(Date.now() + 60_000).toISOString();
    const pending = repo.updateProviderConnection(a.id, { modelLock___all: until });
    const list = await repo.getProviderConnections({ provider: "openai", isActive: true }, { clone: false });
    const seen = list.find((c) => c.id === a.id);
    expect(seen.modelLock___all).toBe(until);
    const byId = await repo.getProviderConnectionById(a.id);
    expect(byId.modelLock___all).toBe(until);
    await pending;
  });
});
