const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");
const { buildTrayArgs } = require("../utils/serverProc");

const APP_NAME = "literouter";
const APP_LABEL = "com.literouter.autostart";
const LEGACY_APP_NAME = "9router";
const LEGACY_APP_LABEL = "com.9router.autostart";

function homeDir() {
  const { HOME, USERPROFILE } = process.env;
  const preferred = process.platform === "win32" ? USERPROFILE || HOME : HOME || USERPROFILE;
  return preferred || os.homedir();
}

function startupDirWindows(appData = process.env.APPDATA) {
  return path.join(appData || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
}

function legacyEntryPath(platform, { home = homeDir(), appData } = {}) {
  if (platform === "darwin") return path.join(home, "Library", "LaunchAgents", `${LEGACY_APP_LABEL}.plist`);
  if (platform === "win32") return path.join(startupDirWindows(appData), `${LEGACY_APP_NAME}.vbs`);
  if (platform === "linux") return path.join(home, ".config", "autostart", `${LEGACY_APP_NAME}.desktop`);
  return null;
}

function removeLegacyAutoStart(platform = process.platform, locations) {
  const legacyPath = legacyEntryPath(platform, locations);
  if (!legacyPath || !fs.existsSync(legacyPath)) return false;
  try {
    if (platform === "darwin") execSync(`launchctl unload "${legacyPath}"`, { stdio: "ignore" });
  } catch (e) {
    if (e?.code === "ENOENT") throw e;
  }
  try {
    fs.unlinkSync(legacyPath);
  } catch (e) {
    return false;
  }
  return true;
}

function getCliJsPath(cliPath) {
  if (cliPath) {
    const resolved = path.resolve(cliPath);
    if (fs.existsSync(resolved)) return resolved;
  }
  if (process.argv[1]) {
    const resolved = path.resolve(process.argv[1]);
    if (path.basename(resolved) === "cli.js" && fs.existsSync(resolved)) {
      return resolved;
    }
  }
  const computed = path.resolve(__dirname, "..", "..", "..", "cli.js");
  if (fs.existsSync(computed)) return computed;
  return null;
}

function enableAutoStart(cliPath, opts = {}) {
  const platform = process.platform;

  if (!["darwin", "win32", "linux"].includes(platform)) return false;
  if (platform === "linux" && !process.env.DISPLAY) return false;

  try {
    removeLegacyAutoStart(platform);
    if (platform === "darwin") return enableMacOS(cliPath, opts);
    if (platform === "win32") return enableWindows(cliPath, opts);
    if (platform === "linux") return enableLinux(cliPath, opts);
  } catch (err) {
    console.error(`[autostart] enable failed: ${err.message}`);
  }
  return false;
}

function disableAutoStart() {
  const platform = process.platform;
  try {
    removeLegacyAutoStart(platform);
    if (platform === "darwin") return disableMacOS();
    if (platform === "win32") return disableWindows();
    if (platform === "linux") return disableLinux();
  } catch (err) {
    console.error(`[autostart] disable failed: ${err.message}`);
  }
  return false;
}

function isAutoStartEnabled() {
  const platform = process.platform;

  try {
    if (platform === "darwin") {
      const plistPath = path.join(homeDir(), "Library", "LaunchAgents", `${APP_LABEL}.plist`);
      if (!fs.existsSync(plistPath)) return false;
      try {
        execSync(`launchctl list ${APP_LABEL}`, {
          stdio: ["ignore", "ignore", "ignore"],
          timeout: 3000
        });
        return true;
      } catch (e) {
        return false;
      }
    } else if (platform === "win32") {
      const startupPath = path.join(startupDirWindows(), `${APP_NAME}.vbs`);
      return fs.existsSync(startupPath);
    } else if (platform === "linux") {
      const desktopPath = path.join(homeDir(), ".config", "autostart", `${APP_NAME}.desktop`);
      return fs.existsSync(desktopPath);
    }
  } catch (e) {
    console.error(`[autostart] status check failed: ${e.message}`);
  }
  return false;
}


function isAgentSelfMacOS() {
  try {
    const output = execSync(`launchctl list ${APP_LABEL}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000
    });
    const match = output.match(/"PID"\s*=\s*(\d+)/);
    return !!(match && parseInt(match[1], 10) === process.pid);
  } catch (e) {
    return false;
  }
}

function enableMacOS(cliPath, opts = {}) {
  const launchAgentsDir = path.join(homeDir(), "Library", "LaunchAgents");
  const plistPath = path.join(launchAgentsDir, `${APP_LABEL}.plist`);

  if (!fs.existsSync(launchAgentsDir)) {
    fs.mkdirSync(launchAgentsDir, { recursive: true });
  }

  const nodePath = process.execPath;
  const routerScript = getCliJsPath(cliPath);
  if (!routerScript) return false;

  const launchPath = `${path.dirname(nodePath)}:/usr/local/bin:/usr/bin:/bin`;
  const argLines = buildTrayArgs(opts)
    .map((a) => `        <string>${a}</string>`)
    .join("\n");

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${APP_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${routerScript}</string>
${argLines}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${launchPath}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/literouter.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/literouter.error.log</string>
</dict>
</plist>`;

  fs.writeFileSync(plistPath, plistContent);

  if (isAgentSelfMacOS()) {
    return true;
  }

  try {
    execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" });
  } catch (e) {
    if (e?.code === "ENOENT") throw e;
  }
  try {
    execSync(`launchctl load -w "${plistPath}"`, { stdio: "ignore" });
  } catch (e) {
    console.error(`[autostart] launchctl load failed: ${e.message}`);
  }
  return true;
}

function disableMacOS() {
  const plistPath = path.join(homeDir(), "Library", "LaunchAgents", `${APP_LABEL}.plist`);

  if (!isAgentSelfMacOS()) {
    try {
      execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" });
    } catch (e) {
      if (e?.code === "ENOENT") throw e;
    }
  }

  if (fs.existsSync(plistPath)) {
    fs.unlinkSync(plistPath);
  }
  return true;
}


function enableWindows(cliPath, opts = {}) {
  const startupDir = startupDirWindows();
  const vbsPath = path.join(startupDir, `${APP_NAME}.vbs`);

  if (!fs.existsSync(startupDir)) return false;

  const nodePath = process.execPath;
  const routerScript = getCliJsPath(cliPath);
  if (!routerScript) return false;

  const vbsArgs = buildTrayArgs(opts).map((a) => `""${a}""`).join(" ");
  const vbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """${nodePath}"" ""${routerScript}"" ${vbsArgs}", 0, False
`;
  fs.writeFileSync(vbsPath, vbsContent);
  return true;
}

function disableWindows() {
  const vbsPath = path.join(startupDirWindows(), `${APP_NAME}.vbs`);
  if (fs.existsSync(vbsPath)) {
    fs.unlinkSync(vbsPath);
  }
  return true;
}


function enableLinux(cliPath, opts = {}) {
  const autostartDir = path.join(homeDir(), ".config", "autostart");
  const desktopPath = path.join(autostartDir, `${APP_NAME}.desktop`);

  if (!fs.existsSync(autostartDir)) {
    try { fs.mkdirSync(autostartDir, { recursive: true }); }
    catch (e) { return false; }
  }

  const nodePath = process.execPath;
  const routerScript = getCliJsPath(cliPath);
  if (!routerScript) return false;

  const execArgs = buildTrayArgs(opts).map((a) => `"${a}"`).join(" ");
  const desktopContent = `[Desktop Entry]
Type=Application
Name=LiteRouter
Comment=LiteRouter API Proxy
Exec="${nodePath}" "${routerScript}" ${execArgs}
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
`;
  fs.writeFileSync(desktopPath, desktopContent);
  return true;
}

function disableLinux() {
  const desktopPath = path.join(homeDir(), ".config", "autostart", `${APP_NAME}.desktop`);
  if (fs.existsSync(desktopPath)) {
    fs.unlinkSync(desktopPath);
  }
  return true;
}

module.exports = {
  enableAutoStart,
  disableAutoStart,
  isAutoStartEnabled,
  removeLegacyAutoStart
};
