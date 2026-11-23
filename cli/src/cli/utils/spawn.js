function buildServerSpawn({ runtime, serverPath, appDir, port, host, showLog }) {
  const cmd = [runtime, "--dns-result-order=ipv4first", serverPath];
  const options = {
    cwd: appDir,
    stdio: showLog ? ["inherit", "inherit", "inherit"] : ["ignore", "ignore", "pipe"],
    detached: true,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || "production",
      PORT: String(port),
      HOSTNAME: host,
    },
  };
  return [cmd, options];
}

module.exports = { buildServerSpawn };
