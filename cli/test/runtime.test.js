import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { backoffMs, buildBunAddArgs, summarizeBunError, isInBackoff, ensureRuntime } = require("../hooks/runtime");
const { getTrayPackages } = require("../hooks/trayRuntime");

const realPlatform = process.platform;
let dataDir;
let prevDataDir;

function setPlatform(value) {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

function failingSpawn() {
  return () => ({
    stderr: new Response("error: connect ECONNREFUSED registry").body,
    exited: Promise.resolve(1),
    kill() {},
  });
}

beforeEach(() => {
  prevDataDir = process.env.DATA_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "literouter-runtime-"));
  process.env.DATA_DIR = dataDir;
});

afterEach(() => {
  setPlatform(realPlatform);
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("runtime self-heal", () => {
  test("backoff doubles from five minutes and caps at 24 hours", () => {
    expect(backoffMs(1)).toBe(300000);
    expect(backoffMs(2)).toBe(600000);
    expect(backoffMs(20)).toBe(86400000);
  });

  test("installs only systray2 on linux and macos", () => {
    for (const platform of ["linux", "darwin"]) {
      setPlatform(platform);
      const packages = getTrayPackages({ silent: true });
      expect(packages).toEqual([{ name: "systray2", version: "2.1.4" }]);
      expect(buildBunAddArgs(packages)).toEqual(["add", "systray2@2.1.4"]);
    }
  });

  test("installs nothing on windows", async () => {
    setPlatform("win32");
    expect(getTrayPackages({ silent: true })).toEqual([]);
    expect(await ensureRuntime({ spawn: () => { throw new Error("must not spawn"); } })).toEqual({ skipped: "windows" });
  });

  test("summarizes network, permission and disk errors", () => {
    expect(summarizeBunError("error: getaddrinfo ENOTFOUND registry.npmjs.org")).toBe("No internet connection or registry unreachable");
    expect(summarizeBunError("EACCES: permission denied, mkdir")).toBe("Permission denied (check folder permissions)");
    expect(summarizeBunError("ENOSPC: no space left on device")).toBe("Not enough disk space");
    expect(summarizeBunError("")).toBe("Unknown error");
  });

  test("a failed install records a marker and the next call is in backoff", async () => {
    setPlatform("linux");
    const first = await ensureRuntime({ spawn: failingSpawn() });
    expect(first.ok).toBe(false);
    expect(first.reason).toBe("No internet connection or registry unreachable");
    expect(existsSync(join(dataDir, "runtime", ".install-failed"))).toBe(true);
    expect(isInBackoff()).toBe(true);
    expect(await ensureRuntime({ spawn: () => { throw new Error("must not spawn"); } })).toEqual({ skipped: "backoff" });
  });
});
