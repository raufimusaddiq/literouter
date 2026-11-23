import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { Glob } from "bun";

const repoRoot = resolve(import.meta.dir, "../..");
const apiRoot = join(repoRoot, "src/app/api");
const { scanApiRoutes, expandRewrites, renderRouteTable } = await import(join(repoRoot, "scripts/gen-route-table.mjs"));
const { routeTable } = await import(join(repoRoot, "src/server/routes.js"));
const rewrites = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/next-rewrites.json"), "utf8"));

const find = (path) => routeTable.filter((e) => e.path === path);

describe("route table", () => {
  test("every route.js is in routeTable", () => {
    const files = [...new Glob("**/route.js").scanSync({ cwd: apiRoot })].map((f) => "api/" + f.replaceAll("\\", "/").replace(/\/route\.js$/, "")).sort();
    const scanned = scanApiRoutes(apiRoot).map((r) => r.source).sort();
    expect(scanned).toEqual(files);
    const inTable = new Set(routeTable.map((e) => e.source));
    for (const source of files) expect(inTable.has(source)).toBe(true);
    for (const source of files) {
      const direct = routeTable.filter((e) => e.source === source && e.path.startsWith("/api/"));
      expect(direct.length).toBe(1);
    }
  });

  test("every entry's source exists and its module exports a handler for each listed method", () => {
    const scanned = new Map(scanApiRoutes(apiRoot).map((r) => [r.source, r]));
    for (const entry of routeTable) {
      const scan = scanned.get(entry.source);
      expect(scan).toBeDefined();
      expect(entry.methods.length).toBeGreaterThan(0);
      expect(entry.methods).toEqual(scan.methods);
      expect(typeof entry.load).toBe("function");
    }
  });

  test("rewrites are covered", () => {
    const sourceOf = (path) => find(path).map((e) => e.source);
    expect(sourceOf("/v1/chat/completions")).toEqual(["api/v1/chat/completions"]);
    expect(sourceOf("/v1/v1/chat/completions")).toEqual(["api/v1/chat/completions"]);
    expect(sourceOf("/v1beta/models")).toEqual(["api/v1beta/models"]);
    expect(sourceOf("/v1/models/:kind")).toEqual(["api/v1/models/[kind]"]);
    expect(sourceOf("/v1/models/*")).toEqual(["api/v1/models/[...model]"]);
    expect(sourceOf("/v1")).toEqual(["api/v1"]);
    expect(sourceOf("/v1/v1")).toEqual(["api/v1"]);
    expect(sourceOf("/v1beta")).toEqual([]);
    expect(sourceOf("/api/v1beta")).toEqual([]);
    expect(sourceOf("/codex")).toEqual(["api/v1/responses"]);
    expect(sourceOf("/codex/*")).toEqual(["api/v1/responses"]);
    expect(sourceOf("/responses")).toEqual(["api/v1/responses"]);
    const expanded = expandRewrites(rewrites, scanApiRoutes(apiRoot));
    for (const alias of expanded) expect(find(alias.path).some((e) => e.source === alias.source)).toBe(true);
    expect(find("/v1/models/*")[0].catchAll).toBe("model");
  });

  test("no duplicate path+source pairs; static beats param beats wildcard", () => {
    const keys = routeTable.map((e) => `${e.path}|${e.source}`);
    expect(new Set(keys).size).toBe(keys.length);
    const paths = routeTable.map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(find("/api/v1/models/info")[0].source).toBe("api/v1/models/info");
    expect(find("/api/v1/models/:kind")[0].source).toBe("api/v1/models/[kind]");
    expect(find("/api/v1/models/*")[0].source).toBe("api/v1/models/[...model]");
  });

  test("scanApiRoutes reads a temp tree", () => {
    const root = mkdtempSync(join(tmpdir(), "route-scan-"));
    try {
      const put = (rel, code) => {
        const file = join(root, rel);
        mkdirSync(join(file, ".."), { recursive: true });
        writeFileSync(file, code);
      };
      put("items/[id]/route.js", "export async function GET() {}\nexport const POST = () => {};\nexport const dynamic = 'force-dynamic';\n");
      put("files/[...rest]/route.js", "const h = () => {};\nexport { h as DELETE, h as OPTIONS };\n");
      put("plain/route.js", "export function GET() {}\n");
      const scanned = scanApiRoutes(root);
      const by = Object.fromEntries(scanned.map((r) => [r.source, r]));
      expect(scanned.length).toBe(3);
      expect(by["api/items/[id]"]).toEqual({ source: "api/items/[id]", path: "/api/items/:id", methods: ["GET", "POST"] });
      expect(by["api/files/[...rest]"]).toEqual({ source: "api/files/[...rest]", path: "/api/files/*", methods: ["DELETE", "OPTIONS"], catchAll: "rest" });
      expect(by["api/plain"].path).toBe("/api/plain");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("load specifiers are static relative imports", () => {
    const text = readFileSync(join(repoRoot, "src/server/routes.js"), "utf8");
    expect(text).toContain('load: () => import("../app/api/v1/chat/completions/route.js")');
    expect(relative(repoRoot, apiRoot).replaceAll("\\", "/")).toBe("src/app/api");
  });
});

test("src/server/routes.js matches the generator output", () => {
  const next = renderRouteTable(scanApiRoutes(apiRoot), rewrites);
  expect(readFileSync(join(repoRoot, "src/server/routes.js"), "utf8").replaceAll("\r\n", "\n")).toBe(next);
});
