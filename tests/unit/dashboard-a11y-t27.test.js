import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

describe("T-27 dashboard leftovers", () => {
  it("token-saver skips headroom requests under minimal profile", () => {
    const src = read("src/web/pages/dashboard/token-saver/TokenSaverClient.js");
    expect(src).toContain("headroomHiddenRef.current = data.minimalProfile === true");
    const guardIdx = src.indexOf("if (headroomHiddenRef.current)");
    const fetchIdx = src.indexOf('fetch("/api/headroom/status"');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(fetchIdx);
  });

  it("UsageTable does not render an empty heading", () => {
    const src = read("src/web/pages/dashboard/usage/components/UsageTable.js");
    expect(src).toMatch(/\{title \? \(\s*<div[^>]*>\s*<h3/);
  });
});

describe("T-30 provider detail a11y", () => {
  it("ModelRow icon buttons are labelled and focus-visible", () => {
    const src = read("src/web/pages/dashboard/providers/[id]/ModelRow.js");
    expect(src).toContain("aria-label={`Copy model ID ${displayModel}`}");
    expect(src).toContain("aria-label={`Disable model ${displayModel}`}");
    expect(src).toContain("aria-label={`Remove custom model ${displayModel}`}");
    expect(src).toMatch(/aria-label=\{`\$\{isTesting \? "Testing model" : "Test model"\} \$\{displayModel\}`\}/);
    expect(src).not.toMatch(/sm:group-hover:opacity-100(?! sm:group-focus-within)/);
  });
});

describe("a11y heading and size guards", () => {
  it("Card title renders as h2 and never h3", () => {
    const s = read("src/shared/components/Card.js");
    expect(s).toMatch(/<h2 [^>]*>\{title\}<\/h2>/);
    expect(s).not.toMatch(/<h3/);
  });

  it("provider detail name is the h1", () => {
    expect(read("src/web/pages/dashboard/providers/[id]/page.js")).toMatch(/<h1[^>]*>\{providerInfo\.name\}<\/h1>/);
  });
});
