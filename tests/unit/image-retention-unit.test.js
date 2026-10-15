import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const unit = readFileSync(new URL("../../scripts/image-retention.service", import.meta.url), "utf8");

/**
 * systemd opens `StandardOutput=append:` / `StandardError=append:` before it runs
 * `ExecStartPre` and before it creates `LogsDirectory=`/`RuntimeDirectory=`
 * directories. Pointing them at a path that only the unit itself could have
 * created therefore fails the unit at start:
 *
 *   Failed to set up standard output: No such file or directory
 *   Process: ExecStartPre=/usr/bin/mkdir -p <dir> (code=exited, status=209/STDOUT)
 *
 * Reproduced on the production host on 2026-10-15 against the shipped unit, and
 * against a `LogsDirectory=` variant. The unit must instead create the directory
 * and open the log inside its own process.
 */
const appendTargets = [...unit.matchAll(/^Standard(?:Output|Error)=append:(\S+)/gm)].map((m) => m[1]);

it("never points append: at a directory only the unit could have created", () => {
  // The regression: this exact shape failed with status=209/STDOUT.
  for (const target of appendTargets) {
    const directory = target.slice(0, target.lastIndexOf("/"));
    const provisionsIt = new RegExp(`mkdir -p ${directory}\\b`).test(unit);
    expect(
      provisionsIt,
      `StandardOutput/StandardError=append:${target} points into ${directory}, which the unit creates itself. ` +
        "systemd sets up stdout before ExecStartPre/LogsDirectory, so the unit fails at start. " +
        "Create the directory and open the log inside ExecStart instead.",
    ).toBe(false);
  }
});

it("creates its log directory and opens the log in its own process", () => {
  const execStart = unit.match(/^ExecStart=(.*)$/m)?.[1];
  expect(execStart, "unit has no ExecStart").toBeTruthy();

  // The directory is created and the log opened by the same process that runs
  // the wrapper, so neither depends on systemd's ordering.
  expect(execStart).toMatch(/mkdir -p \/var\/tmp\/9router-image-retention/);
  expect(execStart).toMatch(/>>\/var\/tmp\/9router-image-retention\/retention\.log/);
  // The wrapper is exec'd, so systemd tracks the real process.
  expect(execStart).toMatch(/exec \/opt\/9router\/scripts\/image-retention\.sh/);
});

it("keeps the scheduled run unprivileged, one-shot, and read-only by default", () => {
  expect(unit).toMatch(/^Type=oneshot$/m);
  expect(unit).toMatch(/^User=ubuntu$/m);
  // Deletion stays a separate, explicitly approved change.
  expect(unit).not.toMatch(/^Environment=LITEROUTER_APPLY=/m);
  expect(unit).not.toMatch(/LITEROUTER_APPLY=true/);
});
