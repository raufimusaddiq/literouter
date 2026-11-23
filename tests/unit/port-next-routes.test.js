import { describe, it, expect, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { transform, transformWithReport, findLeftovers } from "../../scripts/port-next-routes.mjs";

const SCRIPT = path.resolve(import.meta.dir, "../../scripts/port-next-routes.mjs");
const tempDirs = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lr-port-"));
  tempDirs.push(dir);
  return dir;
}

function runCli(args) {
  const proc = Bun.spawnSync(["bun", SCRIPT, ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

describe("port-next-routes transform", () => {
  it("NextResponse.json becomes json with a trimmed import", () => {
    const out = transform(
      'import { NextResponse } from "next/server";\nexport async function GET() {\n  return NextResponse.json({ ok: true });\n}\n',
      "route.js",
    );
    expect(out).toContain('import { json } from "@/server/http.js";');
    expect(out).toContain("return json({ ok: true });");
    expect(out).not.toContain("NextResponse");
    expect(out).not.toContain("next/server");
  });

  it("NextResponse.redirect becomes redirect and both names are imported", () => {
    const out = transform(
      'import { NextResponse } from "next/server";\nexport async function GET(request) {\n  if (a) return NextResponse.redirect(new URL("/x", request.url));\n  return NextResponse.json({});\n}\n',
      "route.js",
    );
    expect(out).toContain('import { json, redirect } from "@/server/http.js";');
    expect(out).toContain('return redirect(new URL("/x", request.url));');
    expect(out).toContain("return json({});");
  });

  it("new NextResponse becomes new Response and needs no import", () => {
    const out = transform(
      'import { NextResponse } from "next/server";\nexport async function OPTIONS() {\n  return new NextResponse(null, { status: 204 });\n}\n',
      "route.js",
    );
    expect(out).toBe('export async function OPTIONS() {\n  return new Response(null, { status: 204 });\n}\n');
  });

  it("nextUrl property access becomes nextUrl(req), with and without optional chaining", () => {
    const out = transform(
      'export async function GET(request) {\n  const a = request.nextUrl.searchParams.get("a");\n  const b = request.nextUrl?.searchParams;\n  const c = request.nextUrl;\n  return new Response(a + b + c);\n}\n',
      "route.js",
    );
    expect(out).toContain('import { nextUrl } from "@/server/http.js";');
    expect(out).toContain('const a = nextUrl(request).searchParams.get("a");');
    expect(out).toContain("const b = nextUrl(request).searchParams;");
    expect(out).toContain("const c = nextUrl(request);");
    expect(out).not.toContain(".nextUrl");
  });

  it("deletes dynamic, maxDuration and revalidate exports", () => {
    const out = transform(
      'export const dynamic = "force-dynamic";\nexport const maxDuration = 300;\nexport const revalidate = 0;\nexport async function GET() {\n  return new Response("x");\n}\n',
      "route.js",
    );
    expect(out).toBe('export async function GET() {\n  return new Response("x");\n}\n');
  });

  it("cookies from next/headers is rebound to the request in scope", () => {
    const out = transform(
      'import { cookies } from "next/headers";\nexport async function POST(request) {\n  const jar = await cookies();\n  return new Response(jar.get("a"));\n}\n',
      "route.js",
    );
    expect(out).toContain('import { cookies } from "@/server/http.js";');
    expect(out).toContain("const jar = cookies(request);");
    expect(out).not.toContain("await cookies()");
  });

  it("adds a request parameter to an exported handler that took none", () => {
    const { code, followUps } = transformWithReport(
      'import { cookies } from "next/headers";\nexport async function POST() {\n  const jar = await cookies();\n  return new Response(jar.get("a"));\n}\n',
      "route.js",
    );
    expect(code).toContain("export async function POST(request) {");
    expect(code).toContain("cookies(request)");
    expect(followUps.some((f) => /request parameter/.test(f))).toBe(true);
  });

  it("reports a cookies() call with no request in scope and leaves it unresolved", () => {
    const { code, followUps } = transformWithReport(
      'import { cookies } from "next/headers";\nasync function helper() {\n  return await cookies();\n}\n',
      "lib.js",
    );
    expect(code).toContain("cookies()");
    expect(followUps.some((f) => /cookies\(\)/.test(f) && /lib\.js/.test(f))).toBe(true);
    expect(findLeftovers(code).length).toBeGreaterThan(0);
  });

  it("finds the request through template literals, nested braces and regex literals", () => {
    const source = [
      'import { cookies } from "next/headers";',
      "export async function POST(request) {",
      "  try {",
      "    const label = `a ${`b ${request.url}`} }`;",
      "    const ok = /[}]{2}/.test(label);",
      "    if (ok) { return new Response(label); }",
      "    const jar = await cookies();",
      "    return new Response(jar.get('a'));",
      "  } catch {",
      "    return new Response(null);",
      "  }",
      "}",
      "",
    ].join("\n");
    const { code, followUps } = transformWithReport(source, "route.js");
    expect(code).toContain("const jar = cookies(request);");
    expect(followUps).toEqual([]);
  });

  it("merges into an existing http.js import without duplicating names", () => {
    const out = transform(
      'import { NextResponse } from "next/server";\nimport { json } from "@/server/http.js";\nexport async function GET() {\n  return NextResponse.json({});\n}\n',
      "route.js",
    );
    expect(out.match(/@\/server\/http\.js/g)).toHaveLength(1);
    expect(out).toContain('import { json } from "@/server/http.js";');
  });

  it("aliases the helper when a local binding already uses the name", () => {
    const out = transform(
      'import { NextResponse } from "next/server";\nexport async function POST(request) {\n  const json = await request.json();\n  return NextResponse.json({ json });\n}\n',
      "route.js",
    );
    expect(out).toContain('import { json as jsonResponse } from "@/server/http.js";');
    expect(out).toContain("const json = await request.json();");
    expect(out).toContain("return jsonResponse({ json });");
  });

  it("reports other next/* imports and NextResponse members it cannot port", () => {
    const { code, followUps } = transformWithReport(
      'import { NextResponse } from "next/server";\nimport { headers } from "next/headers";\nexport async function GET() {\n  return NextResponse.next();\n}\n',
      "route.js",
    );
    expect(followUps.some((f) => /next\/headers/.test(f))).toBe(true);
    expect(followUps.some((f) => /NextResponse\.next/.test(f))).toBe(true);
    expect(findLeftovers(code).length).toBeGreaterThan(0);
  });

  it("handles single quotes and a file with every rule at once", () => {
    const source = [
      "import { NextResponse } from 'next/server'",
      "import { cookies } from 'next/headers'",
      'export const dynamic = "force-dynamic"',
      "export const maxDuration = 10;",
      "export async function POST(req) {",
      "  const jar = await cookies();",
      '  const q = req.nextUrl.searchParams.get("q");',
      "  if (!q) return NextResponse.redirect(new URL('/x', req.url));",
      "  if (jar.get('a')) return new NextResponse(null, { status: 204 });",
      "  return NextResponse.json({ q });",
      "}",
      "",
    ].join("\n");
    const out = transform(source, "route.js");
    expect(out).toContain("import { json, redirect, nextUrl, cookies } from '@/server/http.js'");
    expect(out).toContain("cookies(req)");
    expect(out).toContain('nextUrl(req).searchParams.get("q")');
    expect(out).toContain("redirect(new URL('/x', req.url))");
    expect(out).toContain("new Response(null, { status: 204 })");
    expect(out).toContain("json({ q })");
    expect(out).not.toMatch(/dynamic|maxDuration|NextResponse|next\//);
    expect(findLeftovers(out)).toEqual([]);
  });

  it("is idempotent", () => {
    const source = [
      'import { NextResponse } from "next/server";',
      'import { cookies } from "next/headers";',
      'export const revalidate = 0;',
      "export async function GET(request) {",
      "  const jar = await cookies();",
      "  return NextResponse.json({ a: request.nextUrl.pathname, b: jar.get('x') });",
      "}",
      "",
    ].join("\n");
    const once = transform(source, "route.js");
    expect(transform(once, "route.js")).toBe(once);
    expect(transformWithReport(once, "route.js").followUps).toEqual([]);
  });

  it("leaves a file with nothing to port byte-identical", () => {
    const source = 'export async function GET() {\n  return new Response("x");\n}\n';
    expect(transform(source, "route.js")).toBe(source);
  });
});

describe("port-next-routes CLI", () => {
  it("--check exits 1 while next imports remain and 0 once ported", () => {
    const dir = tempDir();
    const file = path.join(dir, "route.js");
    fs.writeFileSync(
      file,
      'import { NextResponse } from "next/server";\nexport const dynamic = "force-dynamic";\nexport async function GET(request) {\n  return NextResponse.json({ p: request.nextUrl.pathname });\n}\n',
    );
    const before = runCli(["--check", dir]);
    expect(before.code).toBe(1);
    expect(before.stderr).toContain("route.js");

    const run = runCli([dir]);
    expect(run.code).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toContain('import { json, nextUrl } from "@/server/http.js";');

    const after = runCli(["--check", dir]);
    expect(after.code).toBe(0);
  });

  it("--check is scoped to the dirs it is given", () => {
    const clean = tempDir();
    const dirty = tempDir();
    fs.writeFileSync(path.join(clean, "route.js"), 'export async function GET() {\n  return new Response("x");\n}\n');
    fs.writeFileSync(path.join(dirty, "route.js"), 'import { NextResponse } from "next/server";\nexport const GET = () => NextResponse.json({});\n');
    expect(runCli(["--check", clean]).code).toBe(0);
    expect(runCli(["--check", dirty]).code).toBe(1);
    expect(runCli(["--check", clean, dirty]).code).toBe(1);
  });

  it("lists manual follow-ups on stderr and rewrites nothing else", () => {
    const dir = tempDir();
    fs.writeFileSync(
      path.join(dir, "lib.js"),
      'import { cookies } from "next/headers";\nasync function helper() {\n  return await cookies();\n}\n',
    );
    const run = runCli([dir]);
    expect(run.stderr).toMatch(/lib\.js.*cookies\(\)/);
    expect(runCli(["--check", dir]).code).toBe(1);
  });

  it("running twice changes nothing the second time", () => {
    const dir = tempDir();
    const file = path.join(dir, "route.js");
    fs.writeFileSync(file, 'import { NextResponse } from "next/server";\nexport const GET = () => NextResponse.json({});\n');
    runCli([dir]);
    const first = fs.readFileSync(file, "utf8");
    const second = runCli([dir]);
    expect(second.code).toBe(0);
    expect(second.stderr).toBe("");
    expect(fs.readFileSync(file, "utf8")).toBe(first);
  });
});
