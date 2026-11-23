import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = (p) => readFileSync(resolve(__dirname, "../../src", p), "utf8");

describe("a11y structure", () => {
  it("Card title renders as h2 (page h1 > card h2)", () => {
    const s = src("shared/components/Card.js");
    expect(s).toMatch(/<h2 [^>]*>\{title\}<\/h2>/);
    expect(s).not.toMatch(/<h3/);
  });
  it("Badge sm is at least 11px", () => {
    expect(src("shared/components/Badge.js")).toMatch(/sm: "px-2 py-0\.5 text-\[11px\]"/);
  });
  it("provider detail name is the h1", () => {
    expect(src("web/pages/dashboard/providers/[id]/page.js")).toMatch(/<h1[^>]*>\{providerInfo\.name\}<\/h1>/);
  });
});
