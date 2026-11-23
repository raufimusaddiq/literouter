import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

function runInstallScript(body) {
  const data = mkdtempSync(join(tmpdir(), "lr-pxpipe-"));
  const script = `
    const { mkdirSync, writeFileSync } = require("node:fs");
    const { join } = require("node:path");
    const install = await import(${JSON.stringify(join(root, "src/lib/pxpipe/install.js"))});
    let seen = null;
    Bun.spawn = (argv, opts) => {
      seen = { argv, cwd: opts.cwd, beBun: opts.env.BUN_BE_BUN, path: opts.env.PATH === process.env.PATH };
      const pkg = join(install.PXPIPE_DIR, "node_modules", "pxpipe-proxy");
      mkdirSync(join(pkg, "dist", "core"), { recursive: true });
      writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "pxpipe-proxy", version: "9.9.9" }));
      writeFileSync(join(pkg, "dist", "core", "library.js"), "");
      return { exited: Promise.resolve(${body.exitCode ?? 0}), kill() {} };
    };
    ${body.run}
  `;
  try {
    const run = Bun.spawnSync([process.execPath, "-e", script], { cwd: root, env: { ...process.env, DATA_DIR: data } });
    return { run, data };
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
}

describe("pxpipe install on the embedded Bun", () => {
  it("findNpm resolves to the current executable", async () => {
    const { findNpm } = await import("../../src/lib/pxpipe/install.js");
    expect(findNpm()).toBe(process.execPath);
  });

  it("installs with bun add through the executable with BUN_BE_BUN set", () => {
    const { run } = runInstallScript({
      run: `const info = await install.installPxpipe(); console.log(JSON.stringify({ seen, info }));`,
    });
    expect(run.exitCode, run.stderr.toString()).toBe(0);
    const out = JSON.parse(run.stdout.toString().trim().split("\n").pop());
    expect(out.seen.argv).toEqual([process.execPath, "add", "pxpipe-proxy@latest"]);
    expect(out.seen.beBun).toBe("1");
    expect(out.seen.path).toBe(true);
    expect(out.info.version).toBe("9.9.9");
  });

  it("reports a non-zero bun add exit as a bun add failure", () => {
    const { run } = runInstallScript({
      exitCode: 1,
      run: `await install.installPxpipe().then(() => console.log("no error"), (e) => console.log(e.message));`,
    });
    expect(run.stdout.toString()).toMatch(/bun add exited with code 1/);
  });
});
