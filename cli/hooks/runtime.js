const { installRuntime } = require("./sqliteRuntime");
const { getTrayPackages, chmodSystrayBin } = require("./trayRuntime");

async function ensureRuntime({ silent = true } = {}) {
  const res = await installRuntime({ silent, extraPackages: getTrayPackages({ silent }) });
  if (res.ok) chmodSystrayBin({ silent });
  return res;
}

module.exports = { ensureRuntime };
