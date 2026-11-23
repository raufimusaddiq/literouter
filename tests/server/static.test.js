import { describe, it, expect, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lr-static-"));
const publicDir = path.join(root, "pub");
fs.mkdirSync(path.join(publicDir, "nested"), { recursive: true });
fs.writeFileSync(path.join(root, "secret.txt"), "TOP SECRET");
fs.writeFileSync(path.join(publicDir, "ok.txt"), "ok");
fs.writeFileSync(path.join(publicDir, "nested", "data.json"), '{"a":1}');
fs.writeFileSync(path.join(publicDir, "app.js"), "export {}");
fs.writeFileSync(path.join(publicDir, "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
fs.writeFileSync(path.join(publicDir, "sw.js"), "self.skipWaiting()");
fs.writeFileSync(path.join(publicDir, "manifest.webmanifest"), "{}");
fs.writeFileSync(path.join(publicDir, "unknown.zzzunknown"), "bin");
const originalPublicDir = process.env.LITEROUTER_PUBLIC_DIR;
process.env.LITEROUTER_PUBLIC_DIR = publicDir;

const { serveStatic } = await import("../../src/server/static.js");
const { PUBLIC_DIR } = await import("../../src/server/paths.js");

const call = (pathname, method = "GET") => serveStatic(new Request(`http://localhost${pathname}`, { method }));

afterAll(() => {
  if (originalPublicDir === undefined) delete process.env.LITEROUTER_PUBLIC_DIR;
  else process.env.LITEROUTER_PUBLIC_DIR = originalPublicDir;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("paths", () => {
  it("LITEROUTER_PUBLIC_DIR overrides PUBLIC_DIR", () => {
    expect(PUBLIC_DIR).toBe(publicDir);
  });

  it("PUBLIC_DIR defaults to <repo>/public regardless of cwd", () => {
    const pathsModule = path.resolve(import.meta.dir, "../../src/server/paths.js");
    const code = `const { PUBLIC_DIR } = await import(${JSON.stringify(pathsModule)}); console.log(PUBLIC_DIR)`;
    const env = { ...process.env };
    delete env.LITEROUTER_PUBLIC_DIR;
    const proc = Bun.spawnSync([process.execPath, "-e", code], { cwd: os.tmpdir(), env });
    expect(proc.exitCode).toBe(0);
    expect(path.resolve(proc.stdout.toString().trim())).toBe(path.resolve(import.meta.dir, "../../public"));
  });
});

describe("serveStatic", () => {
  it("serves files with the right content types and cache headers", async () => {
    const cases = [
      ["/ok.txt", "text/plain"],
      ["/nested/data.json", "application/json"],
      ["/app.js", "javascript"],
      ["/pic.png", "image/png"],
      ["/sw.js", "javascript"],
      ["/unknown.zzzunknown", "application/octet-stream"],
    ];
    for (const [pathname, type] of cases) {
      const res = await call(pathname);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain(type);
      expect(res.headers.get("cache-control")).toBe("public, max-age=0");
    }
    expect(await (await call("/ok.txt")).text()).toBe("ok");
  });

  it("serves the manifest as application/manifest+json", async () => {
    const res = await call("/manifest.webmanifest");
    expect(res.headers.get("content-type")).toBe("application/manifest+json");
  });

  it("returns null for absent files, directories and the root", async () => {
    expect(await call("/missing.txt")).toBeNull();
    expect(await call("/nested")).toBeNull();
    expect(await call("/")).toBeNull();
  });

  it("returns null for every traversal shape and never leaks the sibling secret", async () => {
    const shapes = [
      "/../secret.txt",
      "/%2e%2e/secret.txt",
      "/%2E%2E/secret.txt",
      "/..%2fsecret.txt",
      "/nested/../../secret.txt",
      "/nested/..%2f..%2fsecret.txt",
      "/nested/%2e%2e/%2e%2e/secret.txt",
      "/..%5csecret.txt",
      "/nested\\..\\..\\secret.txt",
      "/ok.txt%00.png",
      "/%00",
      "//secret.txt",
      "/%2e%2e%2fsecret.txt",
      "/%252e%252e/secret.txt",
      "/%zz",
    ];
    for (const shape of shapes) {
      const req = new Request("http://localhost/x");
      Object.defineProperty(req, "url", { value: `http://localhost${shape}` });
      expect(await serveStatic(req)).toBeNull();
    }
  });

  it("handles GET and HEAD only", async () => {
    expect(await call("/ok.txt", "POST")).toBeNull();
    expect(await call("/ok.txt", "PUT")).toBeNull();
    expect(await call("/ok.txt", "DELETE")).toBeNull();
    const head = await call("/ok.txt", "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("2");
    expect(await head.text()).toBe("");
  });
});

describe("symlink containment", () => {
  const outsideDir = path.join(root, "outside");
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(path.join(outsideDir, "leak.txt"), "LEAKED");
  fs.mkdirSync(path.join(publicDir, "inside-target"));
  fs.writeFileSync(path.join(publicDir, "inside-target", "fine.txt"), "fine");
  fs.symlinkSync(outsideDir, path.join(publicDir, "escape-link"), "junction");
  fs.symlinkSync(path.join(publicDir, "inside-target"), path.join(publicDir, "inside-link"), "junction");

  it("a link inside public/ that points outside does not serve the target", async () => {
    expect(await call("/escape-link/leak.txt")).toBeNull();
  });

  it("a link inside public/ that stays inside is still served", async () => {
    const res = await call("/inside-link/fine.txt");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("fine");
  });
});
