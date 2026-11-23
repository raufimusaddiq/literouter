import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../scripts/build.mjs";

let work;
let outdir;

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "lr-server-bundle-"));
  outdir = join(work, "app");
  await buildApp({ outdir });
}, 180_000);

afterAll(() => {
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe("server bundle", () => {
  it("does not trace the Tailwind build plugin into the server entry", () => {
    const text = readFileSync(join(outdir, "index.js"), "utf8");
    const specifier = /(?:import\(|require\(|from\s*)["'](?:bun-plugin-tailwind|@tailwindcss\/[^"']+|lightningcss[^"']*|tailwindcss)["']/;
    expect(text).not.toMatch(specifier);
    expect(text).not.toContain("detecting-classes-in-source-files");
    expect(text).not.toContain("@tailwindcss/oxide/");
    expect(text).not.toContain("lightningcss/node");
  });

  it("emits no native .node files", () => {
    expect(listFiles(outdir).filter((file) => file.endsWith(".node"))).toEqual([]);
  });

  it("keeps the server bundle small", () => {
    expect(statSync(join(outdir, "index.js")).size).toBeLessThan(8_000_000);
  });
});
