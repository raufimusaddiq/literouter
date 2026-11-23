import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");

export const GUARDED_PATHS = [
  "src/shared/components",
  "src/shared/components/shell",
  "src/shared/components/layouts",
  "src/web/pages/dashboard/overview",
  "src/web/pages/dashboard/DashboardOverview.js",
  "src/web/pages/dashboard/usage/components/ProviderTopology.js",
];

const BACKDROP_BLUR_ALLOWED = new Set(["src/shared/components/shell/TopBar.js"]);

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

function collectReducedMotionCss(css) {
  const blocks = [];
  const needle = "@media (prefers-reduced-motion: reduce)";
  let idx = css.indexOf(needle);
  while (idx !== -1) {
    const open = css.indexOf("{", idx);
    if (open === -1) break;
    let depth = 0;
    let end = open;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    blocks.push(css.slice(open + 1, end));
    idx = css.indexOf(needle, end + 1);
  }
  return blocks.join("\n");
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
    const seen = new Set();
    for (const guarded of GUARDED_PATHS) {
      for (const file of collectJsFiles(guarded)) {
        const rel = path.relative(ROOT, file).split("\\").join("/");
        if (seen.has(rel)) continue;
        seen.add(rel);
        const content = fs.readFileSync(file, "utf8");
        for (const pattern of FORBIDDEN) {
          if (pattern.source === "backdrop-blur" && BACKDROP_BLUR_ALLOWED.has(rel)) continue;
          if (pattern.test(content)) {
            violations.push(`${rel} matched ${pattern}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("topology uses tokens, not hardcoded colours", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "src/web/pages/dashboard/usage/components/ProviderTopology.js"),
      "utf8",
    );
    for (const forbidden of ["#22d3ee", "#4ade80", "#f8fafc", "yellow-300", "yellow-400"]) {
      expect(src).not.toContain(forbidden);
    }
    expect(src.match(/#[0-9a-fA-F]{3,8}\b/g) || []).toEqual([]);
    expect(src).toContain("var(--color-mark-line)");
  });

  it("topology animations respect reduced motion", () => {
    const css = fs.readFileSync(path.join(ROOT, "src/web/globals.css"), "utf8");
    const reduced = collectReducedMotionCss(css);
    expect(reduced).toContain(".topology-edge-kame");
    expect(reduced).toContain(".topology-edge-halo");
    expect(reduced).toContain(".topology-edge-plasma");
    expect(reduced).toContain(".lr-packet");
  });
});
