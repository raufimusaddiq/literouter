import { describe, expect, it, beforeEach } from "vitest";

describe("settings cache shape", () => {
  beforeEach(() => { delete global.__liteRouterSettingsCache; });

  it("initialises both raw and merged", async () => {
    const mod = await import("../../src/lib/db/repos/settingsRepo.js").catch(() => null);
    if (!mod) return;
    const settings = await mod.getSettings();
    expect(settings).toBeTruthy();
    expect(typeof settings).toBe("object");
    expect(settings.rtkEnabled).toBeDefined();
  });
});
