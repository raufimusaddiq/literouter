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

  it("quota account cards use h2, not h3", () => {
    const src = read("src/web/pages/dashboard/usage/components/ProviderLimits/index.js");
    expect(src).toMatch(/<h2 className="text-sm font-semibold text-ink truncate">/);
    expect(src).not.toMatch(/<h3 className="text-sm font-semibold text-ink truncate">/);
  });
});

describe("T-30 provider detail a11y", () => {
  it("PageHeader breadcrumb title is not an h1 and page title is an h1", () => {
    const src = read("src/shared/components/shell/PageHeader.js");
    const crumbBlock = src.match(/<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/)?.[0] || "";
    expect(crumbBlock.length).toBeGreaterThan(0);
    expect(crumbBlock).not.toMatch(/<h1/);
    expect(crumbBlock).toMatch(/<p className="truncate font-medium text-ink">/);
    expect(src).toMatch(/<h1 /);
  });

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

  it.each([
    ["Badge size sm is at least 11px", "src/shared/components/Badge.js", /sm: "[^"]*text-\[11px\]/],
    ["provider detail name is the h1", "src/web/pages/dashboard/providers/[id]/page.js", /<h1[^>]*>\{providerInfo\.name\}<\/h1>/],
  ])("%s", (_label, file, pattern) => {
    expect(read(file)).toMatch(pattern);
  });
});
