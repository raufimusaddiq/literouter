import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const NEXT_IMPORT = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](?:next(?:\/[^"']*)?|@next\/[^"']*)["']/;

const CLIENT_TREES = [
  "src/web",
  "src/shared",
  "src/store",
  "src/i18n",
  "src/app/(dashboard)",
  "src/app/login",
  "src/app/callback",
  "src/app/dashboard",
];

const SHELL_FILES_DELETED_IN_TASK_3 = new Set([
  "src/app/layout.js",
  "src/app/page.js",
  "src/app/(dashboard)/layout.js",
]);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

describe("dashboard client tree", () => {
  it("client tree has no next imports", () => {
    const offenders = [];
    for (const tree of CLIENT_TREES) {
      for (const file of walk(path.join(ROOT, tree))) {
        if (!/\.(js|jsx)$/.test(file)) continue;
        if (NEXT_IMPORT.test(fs.readFileSync(file, "utf8"))) offenders.push(rel(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no dashboard source is left under src/app outside api", () => {
    const leftovers = walk(path.join(ROOT, "src/app"))
      .map(rel)
      .filter((file) => !file.startsWith("src/app/api/"))
      .filter((file) => !SHELL_FILES_DELETED_IN_TASK_3.has(file));
    expect(leftovers).toEqual([]);
  });
});
