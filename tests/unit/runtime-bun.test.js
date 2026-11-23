import { describe, expect, it } from "bun:test";
import { bunCommand } from "../../src/lib/runtimeBun.js";

describe("runtimeBun", () => {
  it("bunCommand sets BUN_BE_BUN and points at the current executable", () => {
    expect(bunCommand()).toEqual({ command: process.execPath, env: { BUN_BE_BUN: "1" } });
  });

  it("BUN_BE_BUN executable runs -e", () => {
    const { command, env } = bunCommand();
    const run = Bun.spawnSync([command, "-e", "process.exit(2)"], { env: { ...process.env, ...env } });
    expect(run.exitCode).toBe(2);
  });
});

describe("runtimeBun outside Bun", () => {
  it("bunCommand returns a null command when process.versions.bun is absent", () => {
    expect(bunCommand({ node: "22.0.0" })).toEqual({ command: null, env: { BUN_BE_BUN: "1" } });
  });

  it("a null command is what findNpm reports as missing", async () => {
    const { findNpm } = await import("../../src/lib/pxpipe/install.js");
    expect(bunCommand({}).command || null).toBeNull();
    expect(findNpm()).toBe(process.execPath);
  });
});
