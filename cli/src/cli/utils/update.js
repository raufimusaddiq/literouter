function buildInstallCmd(pkgName) {
  return `bun add -g ${pkgName}@latest`;
}

module.exports = { buildInstallCmd };
