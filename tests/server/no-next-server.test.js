import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

const root = fileURLToPath(new URL("../../", import.meta.url));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(js|mjs|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (file) => relative(root, file).replaceAll("\\", "/");
const read = (file) => readFileSync(file, "utf8");

describe("Next's server pieces are gone", () => {
  it("no src/server or src/app/api file imports next/*", () => {
    const files = [...walk(join(root, "src/server")), ...walk(join(root, "src/app/api"))];
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((file) => /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']next(?:\/|["'])/.test(read(file)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("custom-server.js, src/proxy.js, src/instrumentation.js do not exist", () => {
    for (const file of ["custom-server.js", "src/proxy.js", "src/instrumentation.js"]) {
      expect(existsSync(join(root, file)), file).toBe(false);
    }
  });

  it("no source reads NINEROUTER_PEER_TOKEN or trusts x-9r-real-ip", () => {
    const files = [...walk(join(root, "src")), ...walk(join(root, "open-sse"))];
    const names = ["NINEROUTER_PEER_TOKEN", "x-9r-real-ip", "x-9r-peer-token", "x-9r-via-proxy"];
    const offenders = [];
    for (const file of files) {
      const text = read(file).toLowerCase();
      for (const name of names) {
        const count = text.split(name.toLowerCase()).length - 1;
        if (count > 0) offenders.push(`${rel(file)}:${name}:${count}`);
      }
    }
    expect(offenders).toEqual(["src/server/index.js:x-9r-real-ip:1", "src/server/index.js:x-9r-peer-token:1", "src/server/index.js:x-9r-via-proxy:1"]);
    const stripList = /const STRIPPED_HEADERS = \[([^\]]*)\]/.exec(read(join(root, "src/server/index.js")));
    expect(stripList).not.toBeNull();
    for (const name of names.slice(1)) expect(stripList[1]).toContain(`"${name}"`);
    expect(stripList[1]).toContain('"x-9r-real-ip"');
  });

  it("next.config.mjs has no rewrites", async () => {
    const text = read(join(root, "next.config.mjs"));
    expect(text).not.toContain("rewrites");
    expect(text).not.toContain("proxyClientMaxBodySize");
    expect(text).not.toContain("serverExternalPackages");
    const config = (await import(join(root, "next.config.mjs"))).default;
    expect(config.rewrites).toBeUndefined();
    expect(config.experimental.proxyClientMaxBodySize).toBeUndefined();
    expect(config.serverExternalPackages).toBeUndefined();
  });
});
