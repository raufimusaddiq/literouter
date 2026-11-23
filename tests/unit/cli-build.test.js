import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, it } from "bun:test";

const require = createRequire(import.meta.url);
const { copyAppBundle, assertRequiredArtifacts } = require("../../cli/scripts/build-cli.js");

const tempDirs = [];

function createTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "literouter-cli-build-"));
  tempDirs.push(tempDir);
  return tempDir;
}

function writeFixture(root, relativePath, contents = relativePath) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return filePath;
}

function createDistApp(distAppDir) {
  writeFixture(distAppDir, "index.js", "server entry");
  writeFixture(distAppDir, "web/index.html", "spa");
  writeFixture(distAppDir, "web/assets/main-abc.js", "spa chunk");
  writeFixture(distAppDir, "public/favicon.svg", "icon");
  writeFixture(distAppDir, "public/providers/openai.png", "png");
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("CLI build app bundle", () => {
  it("copies the app bundle and public assets into cli/app", () => {
    const root = createTempDir();
    const distAppDir = path.join(root, "dist", "app");
    const cliAppDir = path.join(root, "cli", "app");
    createDistApp(distAppDir);

    copyAppBundle(distAppDir, cliAppDir);
    assertRequiredArtifacts(cliAppDir);

    assert.equal(fs.readFileSync(path.join(cliAppDir, "index.js"), "utf8"), "server entry");
    assert.equal(fs.readFileSync(path.join(cliAppDir, "web/assets/main-abc.js"), "utf8"), "spa chunk");
    assert.equal(fs.readFileSync(path.join(cliAppDir, "public/providers/openai.png"), "utf8"), "png");
  });

  it("copy is idempotent and keeps files from an earlier run", () => {
    const root = createTempDir();
    const distAppDir = path.join(root, "dist", "app");
    const cliAppDir = path.join(root, "cli", "app");
    createDistApp(distAppDir);
    writeFixture(cliAppDir, "earlier-run.js", "keep me");

    copyAppBundle(distAppDir, cliAppDir);
    copyAppBundle(distAppDir, cliAppDir);

    assert.equal(fs.readFileSync(path.join(cliAppDir, "earlier-run.js"), "utf8"), "keep me");
    assert.equal(fs.readFileSync(path.join(cliAppDir, "index.js"), "utf8"), "server entry");
  });

  it("reports the missing required artifact path", () => {
    const root = createTempDir();
    const cliAppDir = path.join(root, "cli", "app");
    writeFixture(cliAppDir, "index.js", "server entry");
    writeFixture(cliAppDir, "public/favicon.svg", "icon");

    assert.throws(
      () => assertRequiredArtifacts(cliAppDir),
      (error) =>
        error.message.startsWith("Required CLI app artifact") &&
        error.message.includes(path.join(cliAppDir, "web", "index.html")) &&
        !error.message.includes(path.join(cliAppDir, "index.js")),
    );
  });

  it("skips source maps and env files", () => {
    const root = createTempDir();
    const distAppDir = path.join(root, "dist", "app");
    const cliAppDir = path.join(root, "cli", "app");
    createDistApp(distAppDir);
    writeFixture(distAppDir, "index.js.map", "map");
    writeFixture(distAppDir, ".env", "SECRET=1");
    writeFixture(distAppDir, ".env.local", "SECRET=2");
    writeFixture(distAppDir, "debug.log", "log");

    copyAppBundle(distAppDir, cliAppDir);

    for (const skipped of ["index.js.map", ".env", ".env.local", "debug.log"]) {
      assert.equal(fs.existsSync(path.join(cliAppDir, skipped)), false, skipped);
    }
    assert.equal(fs.existsSync(path.join(cliAppDir, "index.js")), true);
  });
});
