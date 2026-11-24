import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../../src/web/globals.css", import.meta.url)), "utf8");

function iosBlock() {
  const start = css.indexOf("@supports (-webkit-touch-callout: none)");
  if (start < 0) return null;
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
    if (depth === 0) return { start, body: css.slice(start, i + 1) };
  }
  return null;
}

describe("iOS focus zoom", () => {
  it("raises text fields to 16px on iOS so focusing one never zooms the page", () => {
    const block = iosBlock();
    expect(block).not.toBeNull();
    expect(block.body).toContain("select");
    expect(block.body).toContain("textarea");
    expect(block.body).toContain("font-size: max(16px, 1em)");
  });

  it("keeps the rule outside cascade layers so it beats text-sm utilities", () => {
    const before = css.slice(0, iosBlock().start);
    const opened = (before.match(/@layer\b[^{;]*\{/g) || []).length;
    let depth = 0;
    let layered = 0;
    for (const match of before.matchAll(/@layer\b[^{;]*\{|\{|\}/g)) {
      if (match[0].startsWith("@layer")) {
        depth += 1;
        layered += 1;
      } else if (match[0] === "{") depth += 1;
      else depth -= 1;
    }
    expect(opened).toBe(layered);
    expect(depth).toBe(0);
  });
});
