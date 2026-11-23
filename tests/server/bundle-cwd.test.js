import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../scripts/build.mjs";

let work;
let outdir;
const children = [];

function freePort() {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const { port } = probe;
  probe.stop(true);
  return port;
}

async function waitForHealth(base, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early with ${child.exitCode}`);
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.status === 200) return res;
    } catch {
      await Bun.sleep(100);
    }
  }
  throw new Error("server did not answer /api/health within 15s");
}

async function runBundleFrom(cwd, entry) {
  const port = freePort();
  const dataDir = mkdtempSync(join(work, "data-"));
  const env = { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", DATA_DIR: dataDir };
  for (const key of ["NODE_ENV", "LITEROUTER_SPA_DIR", "LITEROUTER_PUBLIC_DIR", "LITEROUTER_BUNDLED"]) delete env[key];
  const child = Bun.spawn(["bun", entry], { cwd, env, stdout: "ignore", stderr: "ignore" });
  children.push(child);
  const base = `http://127.0.0.1:${port}`;
  const health = await waitForHealth(base, child);
  const favicon = await fetch(`${base}/favicon.svg`);
  return { health: health.status, favicon: favicon.status, faviconType: favicon.headers.get("content-type") };
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "lr-bundle-cwd-"));
  outdir = join(work, "app");
  await buildApp({ outdir });
}, 180_000);

afterAll(() => {
  for (const child of children) child.kill();
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("dist/app bundle", () => {
  it("runs from its own directory", async () => {
    const result = await runBundleFrom(outdir, "index.js");
    expect(result.health).toBe(200);
    expect(result.favicon).toBe(200);
    expect(result.faviconType).toContain("image/svg+xml");
  });

  it("runs from another directory", async () => {
    const elsewhere = mkdtempSync(join(work, "cwd-"));
    const result = await runBundleFrom(elsewhere, join(outdir, "index.js"));
    expect(result.health).toBe(200);
    expect(result.favicon).toBe(200);
  });
});
