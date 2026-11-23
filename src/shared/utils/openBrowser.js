const EARLY_EXIT_WINDOW_MS = 2000;

function launcherArgv(url, platform) {
  if (platform === "win32") return ["rundll32", "url.dll,FileProtocolHandler", url];
  if (platform === "darwin") return ["open", url];
  return ["xdg-open", url];
}

function assertWebUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError("openBrowser requires an absolute http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError(`openBrowser refuses ${parsed.protocol} URLs`);
  }
}

export async function openBrowser(url, { spawn = Bun.spawn, platform = process.platform } = {}) {
  assertWebUrl(url);
  const argv = launcherArgv(url, platform);
  const proc = spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  proc.unref?.();
  let timer;
  const stillRunning = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), EARLY_EXIT_WINDOW_MS);
    timer.unref?.();
  });
  try {
    const code = await Promise.race([proc.exited, stillRunning]);
    if (code !== null && code !== 0) throw new Error(`${argv[0]} exited with code ${code}`);
  } finally {
    clearTimeout(timer);
  }
}
