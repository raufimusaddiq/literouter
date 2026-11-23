import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { buildServerSpawn } = require("../src/cli/utils/spawn");

describe("buildServerSpawn", () => {
  const base = {
    runtime: "/usr/bin/bun",
    serverPath: "/pkg/app/index.js",
    appDir: "/pkg/app",
    port: 20128,
    host: "0.0.0.0",
    showLog: false,
  };

  test("server child runs with cwd = app dir and the Bun flags we keep", () => {
    const [cmd, options] = buildServerSpawn(base);
    expect(cmd).toEqual(["/usr/bin/bun", "--dns-result-order=ipv4first", "/pkg/app/index.js"]);
    expect(cmd.some((arg) => arg.includes("--max-old-space-size"))).toBe(false);
    expect(options.cwd).toBe("/pkg/app");
    expect(options.env.PORT).toBe("20128");
    expect(options.env.HOSTNAME).toBe("0.0.0.0");
    expect(options.env.NODE_PATH).toBeUndefined();
    expect(options.detached).toBe(true);
    expect(options.windowsHide).toBe(true);
    expect(options.stdio).toEqual(["ignore", "ignore", "pipe"]);
  });

  test("showLog inherits stdio", () => {
    const [, options] = buildServerSpawn({ ...base, showLog: true });
    expect(options.stdio).toEqual(["inherit", "inherit", "inherit"]);
  });

  test("the bundled server counts as production unless the caller sets NODE_ENV", () => {
    const prev = process.env.NODE_ENV;
    try {
      delete process.env.NODE_ENV;
      expect(buildServerSpawn(base)[1].env.NODE_ENV).toBe("production");
      process.env.NODE_ENV = "test";
      expect(buildServerSpawn(base)[1].env.NODE_ENV).toBe("test");
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  test("a fake app dir child sees cwd, Bun and the flags", async () => {
    const dir = mkdtempSync(join(tmpdir(), "literouter-spawn-"));
    try {
      const entry = join(dir, "index.js");
      writeFileSync(
        entry,
        "console.error(JSON.stringify({ cwd: process.cwd(), bun: Bun.version, argv: process.argv.slice(1), port: process.env.PORT, env: process.env.NODE_ENV }));",
      );
      const [cmd, options] = buildServerSpawn({ ...base, runtime: process.execPath, serverPath: entry, appDir: dir, port: 20199 });
      const proc = Bun.spawn(cmd, { ...options, detached: false });
      const err = await new Response(proc.stderr).text();
      await proc.exited;
      const seen = JSON.parse(err.trim().split("\n").pop());
      expect(seen.bun).toBe(Bun.version);
      expect(seen.port).toBe("20199");
      expect(seen.argv).toEqual([entry]);
      expect(seen.cwd.toLowerCase()).toBe(dir.toLowerCase());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
