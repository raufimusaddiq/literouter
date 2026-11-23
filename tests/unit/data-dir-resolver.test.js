import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { resolveDataDir, describeDataDir } = createRequire(import.meta.url)("../../cli/hooks/dataDir.js");

function sandbox(existing) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lr-datadir-"));
  const appData = path.join(home, "AppData", "Roaming");
  fs.mkdirSync(appData, { recursive: true });
  for (const rel of existing) fs.mkdirSync(path.join(home, rel), { recursive: true });
  return { home, appData };
}

const posix = [
  ["new exists", [".literouter"], ".literouter", "default"],
  ["only legacy exists", [".9router"], ".9router", "legacy"],
  ["both exist, new wins", [".literouter", ".9router"], ".literouter", "default"],
  ["neither exists", [], ".literouter", "default"],
];

describe("resolveDataDir on posix", () => {
  test("DATA_DIR wins and is created as given", () => {
    const { home } = sandbox([".9router", ".literouter"]);
    const configured = path.join(home, "custom", "data");
    const r = resolveDataDir({ env: { DATA_DIR: configured }, platform: "linux", home });
    expect(r).toMatchObject({ dir: configured, source: "env" });
    expect(fs.existsSync(configured)).toBe(true);
  });

  test.each(posix)("%s", (_name, existing, expected, source) => {
    const { home } = sandbox(existing);
    const r = resolveDataDir({ env: {}, platform: "linux", home });
    expect(r.dir).toBe(path.join(home, expected));
    expect(r.source).toBe(source);
  });

  test("neither exists returns the new path without creating anything", () => {
    const { home } = sandbox([]);
    const before = fs.readdirSync(home).sort();
    const r = resolveDataDir({ env: {}, platform: "linux", home });
    expect(r.dir).toBe(path.join(home, ".literouter"));
    expect(fs.readdirSync(home).sort()).toEqual(before);
  });

  test("legacy dir is never created, moved or copied", () => {
    const { home } = sandbox([".9router"]);
    fs.writeFileSync(path.join(home, ".9router", "keep"), "x");
    resolveDataDir({ env: {}, platform: "linux", home });
    expect(fs.existsSync(path.join(home, ".literouter"))).toBe(false);
    expect(fs.readFileSync(path.join(home, ".9router", "keep"), "utf8")).toBe("x");
  });

  test("EACCES on DATA_DIR falls back to the default, legacy aware", () => {
    const { home } = sandbox([".9router"]);
    const warnings = [];
    const mkdir = () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); };
    const r = resolveDataDir({ env: { DATA_DIR: "/root/x" }, platform: "linux", home, mkdir, warn: (m) => warnings.push(m) });
    expect(r).toMatchObject({ dir: path.join(home, ".9router"), source: "legacy" });
    expect(warnings).toHaveLength(1);
  });

  test("other mkdir errors propagate", () => {
    const mkdir = () => { throw Object.assign(new Error("boom"), { code: "ENOSPC" }); };
    expect(() => resolveDataDir({ env: { DATA_DIR: "/x" }, platform: "linux", home: "/h", mkdir })).toThrow("boom");
  });
});

describe("resolveDataDir on Windows", () => {
  const win = (appData, extra = {}) => ({ platform: "win32", home: "C:\\Users\\u", env: { APPDATA: appData, ...extra } });
  const existsIn = (...present) => (p) => present.includes(p);

  test("new default under APPDATA", () => {
    const r = resolveDataDir({ ...win("C:\\A"), exists: existsIn("C:\\A\\literouter"), mkdir() {} });
    expect(r).toMatchObject({ dir: "C:\\A\\literouter", source: "default" });
  });

  test("only legacy APPDATA dir exists", () => {
    const r = resolveDataDir({ ...win("C:\\A"), exists: existsIn("C:\\A\\9router"), mkdir() {} });
    expect(r).toMatchObject({ dir: "C:\\A\\9router", source: "legacy" });
  });

  test("both exist, new wins", () => {
    const r = resolveDataDir({ ...win("C:\\A"), exists: existsIn("C:\\A\\9router", "C:\\A\\literouter"), mkdir() {} });
    expect(r.dir).toBe("C:\\A\\literouter");
  });

  test("neither exists returns the new path without creating it, APPDATA unset uses AppData Roaming", () => {
    const made = [];
    const r = resolveDataDir({ platform: "win32", home: "C:\\Users\\u", env: {}, exists: () => false, mkdir: (d) => made.push(d) });
    expect(r.dir).toBe("C:\\Users\\u\\AppData\\Roaming\\literouter");
    expect(made).toEqual([]);
  });

  test("Unix-style DATA_DIR falls back to the default, legacy aware", () => {
    const warnings = [];
    const r = resolveDataDir({ ...win("C:\\A", { DATA_DIR: "/data" }), exists: existsIn("C:\\A\\9router"), mkdir() {}, warn: (m) => warnings.push(m) });
    expect(r).toMatchObject({ dir: "C:\\A\\9router", source: "legacy" });
    expect(warnings).toHaveLength(1);
  });

  test("Windows DATA_DIR is used unchanged", () => {
    const r = resolveDataDir({ ...win("C:\\A", { DATA_DIR: "D:\\data" }), mkdir() {} });
    expect(r).toMatchObject({ dir: "D:\\data", source: "env" });
  });
});

describe("describeDataDir", () => {
  test("Windows legacy label names APPDATA", () => {
    const r = resolveDataDir({ platform: "win32", home: "h", env: { APPDATA: "A" }, exists: (p) => p.endsWith("9router"), mkdir() {} });
    expect(describeDataDir(r)).toContain("legacy %APPDATA%");
    expect(describeDataDir(r)).toContain("rename to %APPDATA%");
  });

  test("flags the legacy dir", () => {
    const line = describeDataDir({ dir: "/h/.9router", source: "legacy", label: "~/.9router" });
    expect(line).toBe("[DATA_DIR] using legacy ~/.9router at /h/.9router (rename to ~/.literouter when no old 9router is running)");
  });

  test("plain line otherwise", () => {
    expect(describeDataDir({ dir: "/h/.literouter", source: "default", label: "~/.literouter" })).toBe("[DATA_DIR] using /h/.literouter");
  });
});
