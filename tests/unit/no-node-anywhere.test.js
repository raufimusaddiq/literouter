import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dir, "..", "..");
const NODE_GATE = /(^|[ "'(=])(node|npm|npx)([ "')]|\.exe|$)/;

const REMOVED_PACKAGES = [
  "next",
  "@next/third-parties",
  "eslint-config-next",
  "@tailwindcss/postcss",
  "postcss",
  "better-sqlite3",
  "sql.js",
  "@next/swc-linux-x64-musl",
  "lightningcss-linux-x64-musl",
  "@tailwindcss/oxide-linux-x64-musl",
  "undici",
  "open",
  "bcryptjs",
  "uuid",
];

const SKIPPED_DIRS = new Set(["node_modules", ".git"]);

function walk(path, out = []) {
  const stat = statSync(path);
  if (!stat.isDirectory()) {
    out.push(path);
    return out;
  }
  for (const name of readdirSync(path)) {
    if (SKIPPED_DIRS.has(name) || posix(join(path, name)) === "cli/app") continue;
    walk(join(path, name), out);
  }
  return out;
}

function posix(file) {
  return relative(root, file).split(sep).join("/");
}

function gateFiles() {
  return ["scripts", "Dockerfile", ".github", "cli"]
    .map((entry) => join(root, entry))
    .filter(existsSync)
    .flatMap((entry) => walk(entry))
    .filter((file) => {
      const name = posix(file);
      return !name.startsWith("cli/test/") && !name.endsWith(".md");
    });
}

function sourceFiles(dirs) {
  return dirs
    .map((entry) => join(root, entry))
    .filter(existsSync)
    .flatMap((entry) => walk(entry))
    .filter((file) => /\.(js|jsx|mjs|cjs)$/.test(file));
}

describe("no Node anywhere", () => {
  it("package.json has none of the removed packages", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const names = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
    expect(REMOVED_PACKAGES.filter((name) => names.has(name))).toEqual([]);
    expect(Object.keys(pkg).filter((key) => key.startsWith("comment_"))).toEqual([]);
    expect(pkg.optionalDependencies).toBeUndefined();
  });

  it("no package-lock.json exists and bun.lock does", () => {
    expect(existsSync(join(root, "package-lock.json"))).toBe(false);
    expect(existsSync(join(root, "bun.lock"))).toBe(true);
  });

  it("Next and PostCSS entry files are gone", () => {
    for (const file of ["next.config.mjs", "postcss.config.mjs", "custom-server.js", "src/proxy.js", "src/instrumentation.js"]) {
      expect(existsSync(join(root, file))).toBe(false);
    }
  });

  it("no source file imports a removed package", () => {
    const removed = ["next", "undici", "sql\\.js", "better-sqlite3", "bcryptjs", "uuid", "open"].join("|");
    const pattern = new RegExp(`(?:from\\s*|import\\s*\\(\\s*|require\\(\\s*|import\\s+)["'](?:${removed})(?:/[^"']*)?["']`);
    const hits = sourceFiles(["src", "open-sse", "cli", "scripts"])
      .filter((file) => pattern.test(readFileSync(file, "utf8")))
      .map(posix);
    expect(hits).toEqual([]);
  });

  it("no node invocation in CI, Docker, scripts or the CLI", () => {
    const hits = [];
    for (const file of gateFiles()) {
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (NODE_GATE.test(line) || line.includes("#!/usr/bin/env node")) {
            hits.push(`${posix(file)}:${index + 1}: ${line.trim()}`);
          }
        });
    }
    expect(hits).toEqual([]);
  });
});
