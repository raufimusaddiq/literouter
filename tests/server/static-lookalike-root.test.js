import { afterAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "lr-lookalike-"));
const outside = path.join(base, "outside");
fs.mkdirSync(outside);
fs.writeFileSync(path.join(outside, "secret.txt"), "TOP SECRET");

const roots = ["~BUN", "$bunfs"].map((name) => {
  const dir = path.join(base, name, "pub");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "ok.txt"), "ok");
  fs.symlinkSync(outside, path.join(dir, "leak"), "junction");
  return { name, dir };
});

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

function serveWith(publicDir, pathname) {
  const staticModule = path.resolve(import.meta.dir, "../../src/server/static.js");
  const proc = Bun.spawnSync(
    [
      process.execPath,
      "-e",
      `const { serveStatic } = await import(${JSON.stringify(staticModule)});
       const res = await serveStatic(new Request("http://localhost${pathname}"));
       console.log(res ? res.status : "null");`,
    ],
    { env: { ...process.env, LITEROUTER_PUBLIC_DIR: publicDir } },
  );
  expect(proc.exitCode).toBe(0);
  return proc.stdout.toString().trim();
}

describe("serveStatic with embedded-looking on-disk roots", () => {
  for (const { name, dir } of roots) {
    it(`serves a regular file under a ${name} directory`, () => {
      expect(serveWith(dir, "/ok.txt")).toBe("200");
    });

    it(`refuses a link escaping a ${name} directory`, () => {
      expect(serveWith(dir, "/leak/secret.txt")).toBe("null");
    });
  }
});
