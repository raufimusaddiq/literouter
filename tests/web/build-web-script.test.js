import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const SCRIPT = path.join(ROOT, "scripts", "build-web.mjs");

function run(args) {
  const proc = Bun.spawnSync([process.execPath, SCRIPT, ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

describe("scripts/build-web.mjs", () => {
  it("rejects a flag token as the --outdir value", () => {
    const result = run(["--outdir", "--dev"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("--outdir needs a directory");
  });

  it("rejects --outdir with no value", () => {
    const result = run(["--outdir"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("--outdir needs a directory");
  });

  it("lists every file written under assets, including the font files css references", () => {
    const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "lr-build-web-script-"));
    try {
      const result = run(["--outdir", outdir]);
      expect(result.code).toBe(0);
      const written = fs.readdirSync(path.join(outdir, "assets"));
      expect(written.some((name) => name.endsWith(".woff2"))).toBe(true);
      for (const name of written) {
        expect(result.out).toContain(`assets/${name}`);
      }
      expect(result.out).toContain("index.html");
      expect(result.out).toContain(`built ${written.length + 1} files`);
    } finally {
      fs.rmSync(outdir, { recursive: true, force: true });
    }
  }, 120_000);
});
