import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { USAGE, compileOptions, parseArgs } from "../../scripts/build.mjs";

const cwd = resolve("/work/here");

describe("build.mjs arguments", () => {
  it("resolves a relative --outdir against the current directory", () => {
    expect(parseArgs(["--outdir", "out/app"], cwd).outdir).toBe(resolve(cwd, "out/app"));
  });

  it("keeps an absolute --outdir", () => {
    const abs = resolve("/elsewhere/app");
    expect(parseArgs(["--outdir", abs], cwd).outdir).toBe(abs);
  });

  it("takes the executable path for --compile from --outfile", () => {
    const parsed = parseArgs(["--compile", "bun-linux-x64-musl", "--outfile", "bin/lr"], cwd);
    expect(parsed.compile).toBe("bun-linux-x64-musl");
    expect(parsed.outfile).toBe(resolve(cwd, "bin/lr"));
  });

  it("rejects --outdir together with --compile", () => {
    expect(() => parseArgs(["--compile", "bun-linux-x64-musl", "--outdir", "x"], cwd)).toThrow("--outfile");
  });

  it("rejects --outfile without --compile", () => {
    expect(() => parseArgs(["--outfile", "x"], cwd)).toThrow("--compile");
  });

  it("rejects a flag without a value", () => {
    expect(() => parseArgs(["--outdir"], cwd)).toThrow("--outdir needs a value");
  });

  it("documents the relative-path rule in the usage text", () => {
    expect(USAGE).toContain("--outdir");
    expect(USAGE).toContain("--outfile");
    expect(USAGE).toContain("current working directory");
  });
});

describe("compile options", () => {
  it("embeds the assets and ignores .env and bunfig.toml next to the executable", () => {
    const options = compileOptions({ target: "bun-linux-x64-musl", outfile: "/o/lr", assets: ["/a", "/b"] });
    expect(options).toEqual({
      target: "bun-linux-x64-musl",
      outfile: "/o/lr",
      assets: ["/a", "/b"],
      autoloadBunfig: false,
      autoloadDotenv: false,
    });
  });
});
