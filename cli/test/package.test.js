import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const cliDir = join(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8"));

describe("cli package metadata", () => {
  test("package is literouter with a literouter bin", () => {
    expect(pkg.name).toBe("literouter");
    expect(pkg.bin).toEqual({ literouter: "./cli.js" });
  });

  test("is Bun-only", () => {
    expect(pkg.engines).toEqual({ bun: "1.4.4" });
    const first = readFileSync(join(cliDir, "cli.js"), "utf8").split("\n")[0];
    expect(first).toBe("#!/usr/bin/env bun");
  });

  test("has no lifecycle install hooks", () => {
    expect(pkg.scripts.postinstall).toBeUndefined();
    expect(Object.keys(pkg).some((key) => key.startsWith("comment_"))).toBe(false);
    expect(pkg.devDependencies?.nodemon).toBeUndefined();
  });

  test("help output names literouter", () => {
    const result = Bun.spawnSync([process.execPath, "cli.js", "--help"], {
      cwd: cliDir,
      env: { ...process.env, NINEROUTER_UPDATE_PACKAGE: "" },
    });
    const out = result.stdout.toString();
    expect(result.exitCode).toBe(0);
    expect(out).toContain("Usage: literouter");
  });

  test("update command is bun add -g", () => {
    const { buildInstallCmd } = require("../src/cli/utils/update");
    expect(buildInstallCmd("literouter")).toBe("bun add -g literouter@latest");
  });
});
