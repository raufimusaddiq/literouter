import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const IMPORT_OPEN = /(?:from\s+|require\(\s*|import\(\s*)["']open["']/;

describe("the open package is replaced by openBrowser", () => {
  it("is not imported by any server source file", () => {
    const glob = new Bun.Glob("{src,open-sse}/**/*.{js,jsx,mjs}");
    const offenders = [];
    for (const file of glob.scanSync({ cwd: repoRoot })) {
      if (IMPORT_OPEN.test(readFileSync(path.join(repoRoot, file), "utf8"))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("is no longer a runtime dependency", () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    expect(pkg.dependencies?.open).toBeUndefined();
    expect(pkg.devDependencies?.open).toBeUndefined();
  });

  it("is replaced by a launcher built on Bun.spawn, so there is nothing left to keep external", () => {
    const source = readFileSync(path.join(repoRoot, "src/shared/utils/openBrowser.js"), "utf8");
    expect(source).not.toMatch(IMPORT_OPEN);
    expect(source).toMatch(/Bun\.spawn/);
    expect(source).not.toMatch(/import\.meta\.url/);
  });
});
