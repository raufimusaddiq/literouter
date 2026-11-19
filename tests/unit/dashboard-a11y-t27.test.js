import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

describe("T-27 dashboard leftovers", () => {
  it("token-saver skips headroom requests under minimal profile", () => {
    const src = read("src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js");
    expect(src).toContain("headroomHiddenRef.current = data.minimalProfile === true");
    const guardIdx = src.indexOf("if (headroomHiddenRef.current)");
    const fetchIdx = src.indexOf('fetch("/api/headroom/status"');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(fetchIdx);
  });

  it("UsageTable does not render an empty heading", () => {
    const src = read("src/app/(dashboard)/dashboard/usage/components/UsageTable.js");
    expect(src).toMatch(/\{title \? \(\s*<div[^>]*>\s*<h3/);
  });

  it("quota account cards use h2, not h3", () => {
    const src = read("src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js");
    expect(src).toMatch(/<h2 className="text-sm font-semibold text-text-primary truncate">/);
    expect(src).not.toMatch(/<h3 className="text-sm font-semibold text-text-primary truncate">/);
  });
});
