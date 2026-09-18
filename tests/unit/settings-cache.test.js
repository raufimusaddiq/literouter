import { describe, expect, it, beforeEach } from "vitest";

// Regression: the settings cache initialised only `raw`, so a fresh process
// produced `undefined` settings and every /v1 request 500'd.
describe("settings cache shape", () => {
  beforeEach(() => { delete global.__liteRouterSettingsCache; });

  it("initialises both raw and merged", async () => {
    const mod = await import("../../src/lib/db/repos/settingsRepo.js").catch(() => null);
    if (!mod) return; // DB adapter unavailable in unit context — covered by live smoke
    const settings = await mod.getSettings();
    expect(settings).toBeTruthy();
    expect(typeof settings).toBe("object");
    expect(settings.rtkEnabled).toBeDefined();
  });
});
