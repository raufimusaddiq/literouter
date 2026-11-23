import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PINNED = "1.4.4";

function pins() {
  const found = [];
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  found.push({ where: "package.json engines.bun", version: String(pkg.engines?.bun ?? "").replace(/^[^\d]*/, "") });
  const cli = JSON.parse(readFileSync(join(root, "cli", "package.json"), "utf8"));
  found.push({ where: "cli/package.json engines.bun", version: String(cli.engines?.bun ?? "").replace(/^[^\d]*/, "") });
  const workflows = join(root, ".github", "workflows");
  for (const file of new Bun.Glob("*.yml").scanSync({ cwd: workflows })) {
    const text = readFileSync(join(workflows, file), "utf8");
    for (const match of text.matchAll(/bun-version:\s*["']?([^\s"']+)/g)) {
      found.push({ where: `.github/workflows/${file}`, version: match[1] });
    }
  }
  const dockerfile = join(root, "Dockerfile");
  if (existsSync(dockerfile)) {
    const match = readFileSync(dockerfile, "utf8").match(/^ARG BUN_IMAGE=oven\/bun:([\d.]+)-alpine$/m);
    if (match) found.push({ where: "Dockerfile ARG BUN_IMAGE", version: match[1] });
  }
  return found;
}

describe("bun version pin", () => {
  it("every Bun pin is 1.4.4", () => {
    const found = pins();
    expect(found.length).toBeGreaterThan(1);
    for (const pin of found) expect(pin.version, pin.where).toBe(PINNED);
  });
});
