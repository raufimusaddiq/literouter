const VALUE_FLAGS = new Set(["--port", "-p", "--host", "-H"]);
const TRAY_RUNTIME_TIMEOUT_MS = 60000;

function firstPositional(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (VALUE_FLAGS.has(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return { command: arg, index: i };
  }
  return null;
}

function parseCommand(args) {
  const found = firstPositional(args);
  if (!found) return { command: null, rest: args };
  return { command: found.command, rest: args.slice(found.index + 1) };
}

async function awaitTrayRuntime({
  platform = process.platform,
  runtime,
  timeoutMs = TRAY_RUNTIME_TIMEOUT_MS,
  log = console.log,
  appName = "literouter",
} = {}) {
  if (platform !== "darwin" && platform !== "linux") return true;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false }), timeoutMs);
  });
  let result;
  try {
    result = await Promise.race([Promise.resolve().then(runtime), timeout]);
  } catch {
    result = { ok: false };
  } finally {
    clearTimeout(timer);
  }
  const unavailable = !result || result.ok === false || result.skipped === "backoff";
  if (unavailable) log(`Tray icon unavailable (runtime dependencies not installed). Run "${appName} stop" to stop the server.`);
  return !unavailable;
}

module.exports = { firstPositional, parseCommand, awaitTrayRuntime, TRAY_RUNTIME_TIMEOUT_MS };
