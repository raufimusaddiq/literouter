import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");

export const GUARDED_PATHS = ["src/shared/components"];

const EXCLUDED_FILES = new Set(["src/shared/components/Sidebar.js"]);

const FORBIDDEN = [
  /backdrop-blur/,
  /shadow-\[var\(--shadow-(elev|warm|elevated)\)\]/,
  /\bfill-1\b/,
  /animate-(border-glow|pulse-glow)/,
  /rounded-(2xl|\[14px\]|\[20px\])/,
];

function collectJsFiles(targetPath) {
  const full = path.join(ROOT, targetPath);
  const stat = fs.statSync(full);
  if (stat.isFile()) return /\.jsx?$/.test(full) ? [full] : [];
  const results = [];
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const next = path.join(full, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsFiles(path.relative(ROOT, next)));
    } else if (entry.isFile() && /\.jsx?$/.test(entry.name)) {
      results.push(next);
    }
  }
  return results;
}

describe("Route Sheet guards", () => {
  it("globals.css carries the Route Sheet tokens", () => {
    const css = fs.readFileSync(path.join(ROOT, "src/web/globals.css"), "utf8");
    for (const token of [
      "--color-mark: #ffd23f",
      "--color-wire",
      "--color-wire-live",
      "--color-grid",
      "--color-mark-line",
      "--color-raise",
    ]) {
      expect(css).toContain(token);
    }
  });

  it("decorative leftovers are gone", () => {
    const css = fs.readFileSync(path.join(ROOT, "src/web/globals.css"), "utf8");
    for (const leftover of [
      "bg-hero-gradient",
      "bg-vibrancy",
      "traffic-light",
      "btn-cta",
      "border-glow",
      "pulseGlow",
      "ctaShimmer",
      "rgba(79, 70, 229",
    ]) {
      expect(css).not.toContain(leftover);
    }
  });

  it("guarded files use no retired styles", () => {
    const violations = [];
    for (const guarded of GUARDED_PATHS) {
      for (const file of collectJsFiles(guarded)) {
        const rel = path.relative(ROOT, file).split("\\").join("/");
        if (EXCLUDED_FILES.has(rel)) continue;
        const content = fs.readFileSync(file, "utf8");
        for (const pattern of FORBIDDEN) {
          if (pattern.test(content)) {
            violations.push(`${rel} matched ${pattern}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
