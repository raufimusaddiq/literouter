import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { enableAutoStart, disableAutoStart, removeLegacyAutoStart } = require("../src/cli/tray/autostart");

const saved = {};
let home;

const entries = {
  darwin: { dir: () => join(home, "Library", "LaunchAgents"), legacy: "com.9router.autostart.plist", current: "com.literouter.autostart.plist" },
  win32: { dir: () => join(home, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup"), legacy: "9router.vbs", current: "literouter.vbs" },
  linux: { dir: () => join(home, ".config", "autostart"), legacy: "9router.desktop", current: "literouter.desktop" },
};

beforeEach(() => {
  for (const k of ["HOME", "USERPROFILE", "APPDATA", "DISPLAY"]) saved[k] = process.env[k];
  home = mkdtempSync(join(tmpdir(), "lr-autostart-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.APPDATA = join(home, "AppData", "Roaming");
  process.env.DISPLAY = ":0";
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(home, { recursive: true, force: true });
});

function seedLegacy(platform) {
  const { dir, legacy } = entries[platform];
  mkdirSync(dir(), { recursive: true });
  const file = join(dir(), legacy);
  writeFileSync(file, "old");
  return file;
}

describe("legacy 9router autostart entry", () => {
  test.each(["darwin", "win32", "linux"])("removeLegacyAutoStart deletes the old %s entry", (platform) => {
    const file = seedLegacy(platform);
    expect(removeLegacyAutoStart(platform, { home, appData: process.env.APPDATA })).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  test("removeLegacyAutoStart is a no-op without an old entry", () => {
    expect(removeLegacyAutoStart("linux", { home, appData: process.env.APPDATA })).toBe(false);
  });

  test.skipIf(!["win32", "linux"].includes(process.platform))("enable writes the new entry and drops the old one", () => {
    const platform = process.platform;
    const old = seedLegacy(platform);
    expect(enableAutoStart(join(import.meta.dir, "..", "cli.js"))).toBe(true);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(join(entries[platform].dir(), entries[platform].current))).toBe(true);
  });

  test.skipIf(!["win32", "linux"].includes(process.platform))("disable removes both the new and the old entry", () => {
    const platform = process.platform;
    const old = seedLegacy(platform);
    const current = join(entries[platform].dir(), entries[platform].current);
    writeFileSync(current, "new");
    disableAutoStart();
    expect(existsSync(old)).toBe(false);
    expect(existsSync(current)).toBe(false);
  });
});
