#!/usr/bin/env bun

const fs = require("fs");
const path = require("path");

const SKIP_PATTERNS = [/\.map$/, /^\.env(\..*)?$/, /\.log$/];

const REQUIRED_ARTIFACTS = ["index.js", path.join("web", "index.html"), path.join("public", "favicon.svg")];

function shouldSkip(name) {
  return SKIP_PATTERNS.some((pattern) => pattern.test(name));
}

function copyAppBundle(distAppDir, cliAppDir) {
  if (!fs.existsSync(distAppDir)) {
    throw new Error(`App bundle not found: ${distAppDir}`);
  }
  fs.mkdirSync(cliAppDir, { recursive: true });
  for (const entry of fs.readdirSync(distAppDir, { withFileTypes: true })) {
    if (shouldSkip(entry.name)) continue;
    const src = path.join(distAppDir, entry.name);
    const dest = path.join(cliAppDir, entry.name);
    if (entry.isDirectory()) copyAppBundle(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

function assertRequiredArtifacts(cliAppDir) {
  const missing = REQUIRED_ARTIFACTS
    .map((artifact) => path.join(cliAppDir, artifact))
    .filter((artifact) => !fs.existsSync(artifact));
  if (missing.length > 0) {
    throw new Error(`Required CLI app artifact(s) missing:\n${missing.join("\n")}`);
  }
}

function syncVersion(cliDir, rootDir) {
  const cliPkg = JSON.parse(fs.readFileSync(path.join(cliDir, "package.json"), "utf8"));
  const rootPkgPath = path.join(rootDir, "package.json");
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
  if (rootPkg.version === cliPkg.version) {
    console.log(`Version already synced: ${cliPkg.version}`);
    return;
  }
  rootPkg.version = cliPkg.version;
  fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + "\n");
  console.log(`Version synced: ${cliPkg.version}`);
}

async function buildCliPackage({ rootDir, cliAppDir }) {
  console.log("Building LiteRouter CLI package...\n");

  syncVersion(path.join(rootDir, "cli"), rootDir);

  console.log("1. Building the app bundle (scripts/build.mjs)...");
  const proc = Bun.spawn([process.execPath, "scripts/build.mjs"], {
    cwd: rootDir,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`scripts/build.mjs exited with code ${code}`);
  }

  console.log("2. Cleaning old cli/app...");
  fs.rmSync(cliAppDir, { recursive: true, force: true });

  console.log("3. Copying dist/app to cli/app...");
  copyAppBundle(path.join(rootDir, "dist", "app"), cliAppDir);

  console.log("4. Checking required artifacts...");
  assertRequiredArtifacts(cliAppDir);

  console.log("\nCLI package build completed.");
  console.log(`Output: ${cliAppDir}`);
  console.log(`Package size: ${(dirSize(cliAppDir) / 1048576).toFixed(1)} MB`);
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size;
  }
  return total;
}

module.exports = {
  copyAppBundle,
  assertRequiredArtifacts,
  buildCliPackage,
};

if (require.main === module) {
  const cliDir = path.resolve(__dirname, "..");
  buildCliPackage({
    rootDir: path.resolve(cliDir, ".."),
    cliAppDir: process.env.NINEROUTER_CLI_APP_DIR || path.join(cliDir, "app"),
  }).catch((error) => {
    console.error(`Build failed: ${error.message}`);
    process.exit(1);
  });
}
