import { describe, expect, test } from "bun:test";

const { killLauncher, parseChildProcesses, isTrayHelper } = require("../src/cli/utils/killProc");
const { createCrashLog } = require("../src/cli/utils/crashLog");

const TRAY = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:/pkg/literouter/src/cli/tray/tray.ps1 -IconPath x";

describe("killLauncher", () => {
  test("on windows kills the launcher and its tray helper but not other children", () => {
    const killed = [];
    killLauncher(50, {
      platform: "win32",
      listChildren: () => [
        { pid: 60, cmdline: TRAY },
        { pid: 100, cmdline: "C:/bun.exe C:/pkg/app/index.js" },
      ],
      killPid: (pid) => killed.push(pid),
      signalPid: () => {
        throw new Error("unexpected signal");
      },
    });
    expect(killed).toEqual([50, 60]);
  });

  test("lists the children before the launcher dies", () => {
    const order = [];
    killLauncher(50, {
      platform: "win32",
      listChildren: () => {
        order.push("list");
        return [];
      },
      killPid: () => order.push("kill"),
      signalPid: () => {},
    });
    expect(order).toEqual(["list", "kill"]);
  });

  test("on unix sends SIGTERM to the launcher only", () => {
    const signals = [];
    killLauncher(50, {
      platform: "linux",
      listChildren: () => {
        throw new Error("unexpected list");
      },
      killPid: () => {
        throw new Error("unexpected kill");
      },
      signalPid: (pid, sig) => signals.push([pid, sig]),
    });
    expect(signals).toEqual([[50, "SIGTERM"]]);
  });

  test("parses child process rows and recognises the tray helper", () => {
    const rows = parseChildProcesses(`60|${TRAY}\r\n100|bun.exe app\r\n\r\ngarbage\r\n`);
    expect(rows).toEqual([
      { pid: 60, cmdline: TRAY },
      { pid: 100, cmdline: "bun.exe app" },
    ]);
    expect(isTrayHelper(TRAY)).toBe(true);
    expect(isTrayHelper("powershell.exe -File other.ps1")).toBe(false);
    expect(isTrayHelper("bun.exe tray.ps1")).toBe(false);
  });
});

describe("createCrashLog", () => {
  async function* chunks(...parts) {
    for (const p of parts) yield new TextEncoder().encode(p);
  }

  test("collects lines across chunk boundaries and keeps only the tail", async () => {
    const log = createCrashLog(3);
    await log.collect(chunks("a\nb", "\nc\nd\ne"));
    expect(log.lines()).toEqual(["c", "d", "e"]);
  });

  test("each child has its own buffer, so a draining old reader cannot mix logs", async () => {
    const first = createCrashLog();
    const second = createCrashLog();
    let release;
    const gate = new Promise((r) => (release = r));
    async function* slow() {
      yield new TextEncoder().encode("old-1\n");
      await gate;
      yield new TextEncoder().encode("old-2\n");
    }
    const draining = first.collect(slow());
    await second.collect(chunks("new-1\n"));
    release();
    await draining;
    expect(second.lines()).toEqual(["new-1"]);
    expect(first.lines()).toEqual(["old-1", "old-2"]);
  });
});
