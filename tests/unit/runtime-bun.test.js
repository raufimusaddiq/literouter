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
