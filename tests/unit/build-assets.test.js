import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, parse } from "node:path";
import { buildApp, compileApp } from "../../scripts/build.mjs";
import { writeProviderIconManifest } from "../../scripts/gen-provider-icon-manifest.mjs";

let root;

async function stubBuildWeb({ outdir }) {
  mkdirSync(join(outdir, "assets"), { recursive: true });
  writeFileSync(join(outdir, "index.html"), "<!doctype html><html></html>");
  writeFileSync(join(outdir, "assets", "app-abc.js"), "export {}");
  return { outdir };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "lr-build-assets-"));
  mkdirSync(join(root, "src", "server"), { recursive: true });
  mkdirSync(join(root, "src", "shared", "constants"), { recursive: true });
  mkdirSync(join(root, "public", "providers"), { recursive: true });
  writeFileSync(join(root, "package.json"), '{"name":"fixture","version":"1.2.3"}\n');
  writeFileSync(join(root, "public", "favicon.svg"), "<svg>fixture</svg>");
  writeFileSync(join(root, "public", "providers", "alpha.png"), "png");
  writeFileSync(
    join(root, "src", "server", "index.js"),
    'export const isBundled = process.env.LITEROUTER_BUNDLED === "1";\nexport async function startServer() { return isBundled; }\n',
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe("buildApp", () => {
  it("copies public assets next to the bundle", async () => {
    const { outdir } = await buildApp({ root, outdir: join(root, "dist", "app"), buildWeb: stubBuildWeb });
    expect(readFileSync(join(outdir, "public", "favicon.svg"), "utf8")).toBe("<svg>fixture</svg>");
    expect(existsSync(join(outdir, "public", "providers", "alpha.png"))).toBe(true);
  });

  it("honours a custom outdir", async () => {
    const custom = join(root, "elsewhere", "bundle");
    const result = await buildApp({ root, outdir: custom, buildWeb: stubBuildWeb });
    expect(result.outdir).toBe(custom);
    expect(existsSync(join(custom, "index.js"))).toBe(true);
    expect(existsSync(join(custom, "web", "index.html"))).toBe(true);
    expect(result.files).toContain("index.js");
  });

  it("emits the server entry as index.js with LITEROUTER_BUNDLED inlined", async () => {
    const outdir = join(root, "dist", "inlined");
    await buildApp({ root, outdir, buildWeb: stubBuildWeb });
    const text = readFileSync(join(outdir, "index.js"), "utf8");
    expect(text).not.toContain("LITEROUTER_BUNDLED");
    expect(existsSync(join(outdir, "index.js"))).toBe(true);
    const bundled = await import(join(outdir, "index.js"));
    expect(await bundled.startServer()).toBe(true);
  });

  it("removes stale web output before building the SPA", async () => {
    const outdir = join(root, "dist", "stale");
    mkdirSync(join(outdir, "web", "assets"), { recursive: true });
    writeFileSync(join(outdir, "web", "assets", "old-111.js"), "old");
    await buildApp({ root, outdir, buildWeb: stubBuildWeb });
    expect(readdirSync(join(outdir, "web", "assets"))).toEqual(["app-abc.js"]);
  });

  it("removes the whole outdir so stale hashed files do not accumulate", async () => {
    const outdir = join(root, "dist", "reused");
    mkdirSync(outdir, { recursive: true });
    writeFileSync(join(outdir, "index-old123.js"), "old");
    await buildApp({ root, outdir, buildWeb: stubBuildWeb });
    expect(existsSync(join(outdir, "index-old123.js"))).toBe(false);
    expect(existsSync(join(outdir, "index.js"))).toBe(true);
  });

  it("refuses an outdir that is the repo root or a parent of it", async () => {
    const marker = join(root, "keep.txt");
    writeFileSync(marker, "keep");
    await expect(buildApp({ root, outdir: root, buildWeb: stubBuildWeb })).rejects.toThrow("refusing to remove");
    await expect(buildApp({ root, outdir: dirname(root), buildWeb: stubBuildWeb })).rejects.toThrow("refusing to remove");
    await expect(buildApp({ root, outdir: parse(root).root, buildWeb: stubBuildWeb })).rejects.toThrow("refusing to remove");
    expect(readFileSync(marker, "utf8")).toBe("keep");
  });

  it("does not copy a server wrapper into the bundle", async () => {
    writeFileSync(join(root, "custom-server.js"), "wrapper");
    const { outdir, files } = await buildApp({ root, outdir: join(root, "dist", "nowrapper"), buildWeb: stubBuildWeb });
    expect(existsSync(join(outdir, "custom-server.js"))).toBe(false);
    expect(files).not.toContain("custom-server.js");
  });

  it("does not modify the root package.json", async () => {
    const before = readFileSync(join(root, "package.json"));
    await buildApp({ root, outdir: join(root, "dist", "pkg"), buildWeb: stubBuildWeb });
    expect(readFileSync(join(root, "package.json")).equals(before)).toBe(true);
  });

  it("regenerates the icon manifest from public/providers", async () => {
    await buildApp({ root, outdir: join(root, "dist", "manifest"), buildWeb: stubBuildWeb });
    const manifest = readFileSync(join(root, "src", "shared", "constants", "providerIconManifest.js"), "utf8");
    expect(manifest).toContain('"alpha"');
  });
});

describe("writeProviderIconManifest", () => {
  const manifest = () => join(root, "src", "shared", "constants", "providerIconManifest.js");

  it("leaves a CRLF checkout of identical content untouched", () => {
    writeProviderIconManifest({ root });
    const crlf = readFileSync(manifest(), "utf8").replace(/\n/g, "\r\n");
    writeFileSync(manifest(), crlf);
    writeProviderIconManifest({ root });
    expect(readFileSync(manifest(), "utf8")).toBe(crlf);
  });

  it("rewrites when the content differs", () => {
    writeFileSync(manifest(), "stale");
    writeProviderIconManifest({ root });
    expect(readFileSync(manifest(), "utf8")).toContain("alpha");
  });
});

describe("compileApp", () => {
  it("rejects targets outside the musl pair", async () => {
    await expect(compileApp({ target: "bun-windows-x64", root })).rejects.toThrow("unsupported compile target: bun-windows-x64");
  });
});
