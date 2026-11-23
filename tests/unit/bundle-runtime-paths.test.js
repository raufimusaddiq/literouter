import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverDir = join(root, "src", "server");
const pkgVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const ENV_KEYS = ["LITEROUTER_BUNDLED", "LITEROUTER_PUBLIC_DIR", "LITEROUTER_SPA_DIR"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalCwd = process.cwd();
let nonce = 0;

function loadPaths(env = {}) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  return import(`../../src/server/paths.js?case=${++nonce}`);
}

afterEach(() => {
  process.chdir(originalCwd);
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("bundle-safe runtime paths", () => {
  it("getAppVersion reads the packaged version regardless of cwd", async () => {
    process.chdir(tmpdir());
    const { getAppVersion } = await import(`../../src/lib/db/version.js?case=${++nonce}`);
    expect(getAppVersion()).toBe(pkgVersion);
  });

  it("appConstants version is the package version", async () => {
    process.chdir(tmpdir());
    const { getAppPackageVersion } = await import(`../../open-sse/config/appConstants.js?case=${++nonce}`);
    expect(getAppPackageVersion()).toBe(pkgVersion);
  });

  it("PUBLIC_DIR points at the repo public dir in a source run", async () => {
    const paths = await loadPaths();
    expect(paths.isBundled).toBe(false);
    expect(paths.PUBLIC_DIR).toBe(join(root, "public"));
    expect(existsSync(join(paths.PUBLIC_DIR, "favicon.svg"))).toBe(true);
  });

  it("LITEROUTER_PUBLIC_DIR overrides PUBLIC_DIR", async () => {
    const dir = join(tmpdir(), "lr-public-override");
    const source = await loadPaths({ LITEROUTER_PUBLIC_DIR: dir });
    expect(source.PUBLIC_DIR).toBe(resolve(dir));
    const bundled = await loadPaths({ LITEROUTER_BUNDLED: "1", LITEROUTER_PUBLIC_DIR: dir });
    expect(bundled.PUBLIC_DIR).toBe(resolve(dir));
  });

  it("a bundled run resolves PUBLIC_DIR and SPA_DIR next to the module, and LITEROUTER_SPA_DIR still overrides", async () => {
    const bundled = await loadPaths({ LITEROUTER_BUNDLED: "1" });
    expect(bundled.isBundled).toBe(true);
    expect(bundled.PUBLIC_DIR).toBe(join(serverDir, "public"));
    expect(bundled.SPA_DIR).toBe(join(serverDir, "web"));
    expect(bundled.SPA_DIR_OVERRIDE).toBeNull();
    const dir = join(tmpdir(), "lr-spa-override");
    const overridden = await loadPaths({ LITEROUTER_BUNDLED: "1", LITEROUTER_SPA_DIR: dir });
    expect(overridden.SPA_DIR).toBe(resolve(dir));
  });

  it("isCompiled is false in a plain source run", async () => {
    const paths = await loadPaths();
    expect(paths.isCompiled).toBe(false);
  });

  it("a bundled getAppVersion and getAppPackageVersion read the package version from any cwd", async () => {
    const work = join(tmpdir(), `lr-version-probe-${process.pid}`);
    const out = join(work, "out");
    const cwd = join(work, "cwd");
    const entry = join(work, "entry.js");
    await Bun.write(entry, `import { getAppVersion } from ${JSON.stringify(join(root, "src", "lib", "db", "version.js"))};
import { getAppPackageVersion } from ${JSON.stringify(join(root, "open-sse", "config", "appConstants.js"))};
console.log(JSON.stringify([getAppVersion(), getAppPackageVersion()]));
`);
    await Bun.write(join(cwd, ".keep"), "");
    const built = await Bun.build({ entrypoints: [entry], outdir: out, target: "bun", naming: { entry: "index.js" } });
    expect(built.success).toBe(true);
    const run = Bun.spawnSync([process.execPath, join(out, "index.js")], { cwd });
    expect(run.stderr.toString()).toBe("");
    expect(JSON.parse(run.stdout.toString().trim())).toEqual([pkgVersion, pkgVersion]);
  });

  it("a bundle resolves its assets from import.meta.dir, not from cwd", async () => {
    const work = join(tmpdir(), `lr-bundle-probe-${process.pid}`);
    const out = join(work, "out");
    await Bun.write(join(work, "src", "m.js"), 'import { join } from "node:path";\nconsole.log(await Bun.file(join(import.meta.dir, "public", "x.txt")).text());\n');
    await Bun.write(join(out, "public", "x.txt"), "found");
    const built = await Bun.build({ entrypoints: [join(work, "src", "m.js")], outdir: out, target: "bun", naming: { entry: "index.js" } });
    expect(built.success).toBe(true);
    const run = Bun.spawnSync([process.execPath, join(out, "index.js")], { cwd: tmpdir() });
    expect(run.stdout.toString().trim()).toBe("found");
  });

  it("no server code resolves public/ from cwd", () => {
    const glob = new Bun.Glob("**/*.js");
    for (const file of glob.scanSync({ cwd: serverDir })) {
      const source = readFileSync(join(serverDir, file), "utf8");
      expect(source.includes("process.cwd()") && /["']public["']/.test(source), file).toBe(false);
    }
  });

  it("the updater package metadata points at the literouter Bun package", async () => {
    const { UPDATER_CONFIG } = await import("../../src/shared/constants/config.js");
    expect(UPDATER_CONFIG.npmPackageName).toBe("literouter");
    expect(UPDATER_CONFIG.installCmd).toBe("bun add -g literouter");
    expect(UPDATER_CONFIG.installCmdLatest).toBe("bun add -g literouter@latest");
  });
});
