import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("open must not be bundled into the server build", () => {
  const config = readFileSync(path.join(repoRoot, "next.config.mjs"), "utf8");

  it("is declared in serverExternalPackages", () => {
    const match = config.match(/serverExternalPackages:\s*\[([^\]]*)\]/);
    expect(match, "serverExternalPackages not found in next.config.mjs").toBeTruthy();
    const packages = match[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
    expect(packages).toContain("open");
  });

  it("stays a runtime dependency so the standalone output can resolve it", async () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    expect(pkg.dependencies?.open).toBeTruthy();
  });

  it("resolves its own directory from import.meta.url, which is why it must stay external", async () => {
    const entry = path.join(repoRoot, "node_modules", "open", "index.js");
    const source = readFileSync(entry, "utf8");
    expect(source).toMatch(/import\.meta\.url/);
  });
});
