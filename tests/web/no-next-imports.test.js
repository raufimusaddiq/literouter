import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const NEXT_IMPORT = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](?:next(?:\/[^"']*)?|@next\/[^"']*)["']/;
const SCANNED = ["src", "open-sse", "scripts", "cli/src"];
const LEFTOVER_RULES = [
  ["NextResponse reference", /\bNextResponse\b/],
  [".nextUrl access", /\.nextUrl\b/],
  ["Next route segment export", /^[ \t]*export\s+const\s+(?:dynamic|maxDuration|revalidate)\b/],
];
const FORBIDDEN_PACKAGES = ["next", "@next/third-parties", "@next/swc-linux-x64-musl", "postcss", "@tailwindcss/postcss", "eslint-config-next", "@next/eslint-plugin-next"];
const FORBIDDEN_SCRIPTS = ["build:webpack", "build:bun", "prebuild:bun", "postbuild", "postbuild:bun"];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

export function findLeftovers(source) {
  const hits = [];
  source.split(/\r?\n/).forEach((line, index) => {
    for (const [label, pattern] of LEFTOVER_RULES) {
      if (pattern.test(line)) hits.push(`${index + 1}: ${label}`);
    }
  });
  return hits;
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

describe("next is gone from the repo", () => {
  it("no source file imports next", () => {
    const offenders = [];
    for (const tree of SCANNED) {
      for (const file of walk(path.join(ROOT, tree))) {
        if (!/\.(js|jsx|mjs|cjs)$/.test(file)) continue;
        if (NEXT_IMPORT.test(fs.readFileSync(file, "utf8"))) offenders.push(rel(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no source file keeps a NextResponse, .nextUrl or route segment export", () => {
    const offenders = [];
    for (const tree of SCANNED) {
      for (const file of walk(path.join(ROOT, tree))) {
        if (!/\.(js|jsx|mjs|cjs)$/.test(file)) continue;
        for (const hit of findLeftovers(fs.readFileSync(file, "utf8"))) offenders.push(`${rel(file)}:${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the leftover rules flag each planted violation", () => {
    expect(findLeftovers("return NextResponse.json({});")).toEqual(["1: NextResponse reference"]);
    expect(findLeftovers("const q = request.nextUrl.searchParams;")).toEqual(["1: .nextUrl access"]);
    for (const name of ["dynamic", "maxDuration", "revalidate"]) {
      expect(findLeftovers(`ok\nexport const ${name} = 1;`)).toEqual(["2: Next route segment export"]);
    }
    expect(findLeftovers("const dynamic = 1;\nconst url = request.url;")).toEqual([]);
  });

  it("root package.json has no next packages", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const declared = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ];
    expect(declared.filter((name) => FORBIDDEN_PACKAGES.includes(name))).toEqual([]);
  });

  it("root package.json has no script that runs next or the standalone copy", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const scripts = pkg.scripts ?? {};
    expect(Object.keys(scripts).filter((name) => FORBIDDEN_SCRIPTS.includes(name))).toEqual([]);
    expect(Object.entries(scripts).filter(([, command]) => /\bnext\b|copy-standalone-assets/.test(command))).toEqual([]);
    expect(scripts.build).toBe("bun scripts/build.mjs");
  });

  it("src/app contains only api", () => {
    const entries = fs.readdirSync(path.join(ROOT, "src/app"));
    expect(entries).toEqual(["api"]);
  });

  it("the Next config and server pieces are deleted", () => {
    for (const file of ["next.config.mjs", "postcss.config.mjs", "custom-server.js", "src/proxy.js", "src/instrumentation.js"]) {
      expect(fs.existsSync(path.join(ROOT, file))).toBe(false);
    }
  });
});
