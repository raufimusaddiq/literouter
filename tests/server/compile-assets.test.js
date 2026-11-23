import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileApp } from "../../scripts/build.mjs";
import { isEmbeddedPath } from "../../src/server/paths.js";

const docker = Bun.which("docker");
const dockerReady = docker
  ? Bun.spawnSync([docker, "info", "--format", "{{.ServerVersion}}"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0
  : false;
const dockerTest = dockerReady ? it : it.skip;

let work;
let exe;
let report;

async function stubBuildWeb({ outdir }) {
  mkdirSync(join(outdir, "assets"), { recursive: true });
  writeFileSync(join(outdir, "index.html"), "<!doctype html><html><head></head></html>");
  writeFileSync(join(outdir, "assets", "app-abc.js"), "export const x = 1;");
  return { outdir };
}

function runInAlpine() {
  const run = Bun.spawnSync(
    [
      docker, "run", "--rm", "-v", `${work}:/work:ro`, "alpine:3.22", "sh", "-c",
      "apk add -q --no-cache libstdc++ libgcc && cp /work/bin /tmp/lr && chmod +x /tmp/lr && cd /tmp && /tmp/lr",
    ],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
  );
  if (run.exitCode !== 0) throw new Error(`docker run failed: ${run.stderr.toString()}${run.stdout.toString()}`);
  const line = run.stdout.toString().trim().split("\n").pop();
  return JSON.parse(line);
}

beforeAll(async () => {
  if (!dockerReady) return;
  work = mkdtempSync(join(tmpdir(), "lr-compile-assets-"));
  exe = await compileApp({
    target: "bun-linux-x64-musl",
    entry: "tests/server/fixtures/compile-static-entry.js",
    outfile: join(work, "bin"),
    buildWeb: stubBuildWeb,
  });
  report = runInAlpine();
}, 300_000);

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("compileApp embedded assets", () => {
  it("rejects a target that is not a musl release target", async () => {
    await expect(compileApp({ target: "bun-windows-x64" })).rejects.toThrow("unsupported compile target: bun-windows-x64");
  });

  it("recognises embedded filesystem roots on Linux and Windows", () => {
    expect(isEmbeddedPath("/$bunfs/root/public")).toBe(true);
    expect(isEmbeddedPath("B:\\~BUN\\root\\web")).toBe(true);
    expect(isEmbeddedPath("/app/public")).toBe(false);
    expect(isEmbeddedPath("/tmp/$bunfs/x")).toBe(false);
    expect(isEmbeddedPath("/home/u/~BUN/pub")).toBe(false);
    expect(isEmbeddedPath("C:\\work\\~BUN\\pub")).toBe(false);
  });

  dockerTest("embeds public and web under import.meta.dir", () => {
    expect(exe).toBe(join(work, "bin"));
    expect(report.isCompiled).toBe(true);
    expect(report.publicDir).toBe("/$bunfs/root/public");
    expect(report.spaDir).toBe("/$bunfs/root/web");
    expect(report.hasIndex).toBe(true);
  });

  dockerTest("removes the compile stage directory after a successful compile", () => {
    expect(existsSync(join(import.meta.dir, "..", "..", "dist", "compile-stage"))).toBe(false);
  });

  dockerTest("serves a public file from the embedded filesystem", () => {
    expect(report.results["/favicon.svg"].status).toBe(200);
  });

  dockerTest("serves a hashed SPA asset as immutable from the embedded filesystem", () => {
    expect(report.results["/assets/app-abc.js"].status).toBe(200);
    expect(report.results["/assets/app-abc.js"].cache).toContain("immutable");
    expect(report.results["/assets/app-abc.js"].body).toContain("export const x");
  });

  dockerTest("still refuses missing files and traversal", () => {
    expect(report.results["/assets/missing.js"]).toBeNull();
    expect(report.results["/assets/..%2findex.html"]).toBeNull();
  });
});
