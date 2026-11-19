import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROVIDERS_WITHOUT_ICON } from "@/shared/utils/providerIcon.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

describe("dashboard client requests", () => {
  it("does not call usage routes removed in #168", () => {
    const offenders = walk(path.join(root, "src"))
      .filter((f) => !f.includes(`${path.sep}api${path.sep}`))
      .filter((f) => /\/api\/usage\/(history|logs)\b/.test(fs.readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("every registry provider has a logo or is listed as icon-less", () => {
    const dir = path.join(root, "open-sse/providers/registry");
    const ids = fs.readdirSync(dir).filter((f) => f.endsWith(".js") && f !== "index.js").map((f) => f.slice(0, -3));
    const missing = ids.filter((id) => !fs.existsSync(path.join(root, "public/providers", `${id}.png`)));
    expect(new Set(missing)).toEqual(PROVIDERS_WITHOUT_ICON);
  });
});
