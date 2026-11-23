function parseChildProcesses(output) {
  const rows = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\|(.*)$/);
    if (match) rows.push({ pid: parseInt(match[1], 10), cmdline: match[2].trim() });
  }
  return rows;
}

function isTrayHelper(cmdline) {
  const text = String(cmdline || "");
  return /powershell/i.test(text) && /tray\.ps1/i.test(text);
}

function listChildProcesses(pid) {
  try {
    const proc = Bun.spawnSync(
      [
        "powershell",
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${pid}' | % { "$($_.ProcessId)|$($_.CommandLine)" }`,
      ],
      { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
    );
    if (proc.exitCode !== 0) return [];
    return parseChildProcesses(proc.stdout.toString());
  } catch {
    return [];
  }
}

function killLauncher(pid, { platform = process.platform, listChildren = listChildProcesses, killPid, signalPid }) {
  if (platform !== "win32") {
    signalPid(pid, "SIGTERM");
    return [];
  }
  const helpers = listChildren(pid)
    .filter((child) => isTrayHelper(child.cmdline))
    .map((child) => child.pid);
  killPid(pid);
  for (const helper of helpers) killPid(helper);
  return helpers;
}

module.exports = { parseChildProcesses, isTrayHelper, listChildProcesses, killLauncher };
