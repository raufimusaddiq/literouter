import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { collectIcons, readFontIcons } from "../../scripts/gen-icon-font.mjs";

const read = (name) => readFileSync(fileURLToPath(new URL(`../../src/web/${name}`, import.meta.url)), "utf8");

function unlayeredIconRules(css) {
  let depth = 0;
  let layerDepth = null;
  const hits = [];
  const re = /@layer\b[^{;]*\{|\{|\}|\.material-symbols-outlined[^{]*\{/g;
  for (const match of css.matchAll(re)) {
    const token = match[0];
    if (token.startsWith("@layer")) {
      depth += 1;
      if (layerDepth === null) layerDepth = depth;
    } else if (token.startsWith(".material-symbols-outlined")) {
      if (layerDepth === null) hits.push(token);
      depth += 1;
    } else if (token === "{") {
      depth += 1;
    } else {
      if (layerDepth === depth) layerDepth = null;
      depth -= 1;
    }
  }
  return hits;
}

describe("icon font CSS", () => {
  it("keeps every icon rule inside a cascade layer so size and animate-spin utilities win", () => {
    expect(unlayeredIconRules(read("globals.css"))).toEqual([]);
  });

  it("ships a glyph in the subset font for every icon name the source uses", () => {
    const shipped = new Set(readFontIcons());
    expect(collectIcons().filter((name) => !shipped.has(name))).toEqual([]);
  });
});
