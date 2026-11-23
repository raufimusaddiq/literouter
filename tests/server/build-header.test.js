import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useTempDataDirAtLoad } from "../helpers/tempDataDir.js";
import { mockBootCollaborators } from "../helpers/bootMocks.js";

const spaDir = fs.mkdtempSync(path.join(os.tmpdir(), "lr-build-header-"));
const originalSpaDir = process.env.LITEROUTER_SPA_DIR;
process.env.LITEROUTER_SPA_DIR = spaDir;
const withEntry = '<html><head></head><body><script type="module" crossorigin src="/assets/index-abc123.js"></script></body></html>';
fs.writeFileSync(path.join(spaDir, "index.html"), withEntry);

useTempDataDirAtLoad("lr-build-header-data-");
mockBootCollaborators();

const { startServer } = await import("../../src/server/index.js");
const { invalidateSpa } = await import("../../src/server/spaBuild.js");
const { extractEntry, BUILD_HEADER } = await import("../../src/shared/utils/buildEntry.js");

let server;
let base;

const get = (pathname) => fetch(`${base}${pathname}`, { redirect: "manual" });

beforeAll(async () => {
  server = await startServer({ port: 0, hostname: "127.0.0.1" });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  if (originalSpaDir === undefined) delete process.env.LITEROUTER_SPA_DIR;
  else process.env.LITEROUTER_SPA_DIR = originalSpaDir;
  fs.rmSync(spaDir, { recursive: true, force: true });
});

describe("build header", () => {
  it.each([
    ["an API route", "/api/health", 200],
    ["an unauthorised API call", "/api/settings", 401],
  ])("%s carries the index entry", async (_name, pathname, status) => {
    const res = await get(pathname);
    expect(res.status).toBe(status);
    expect(res.headers.get(BUILD_HEADER)).toBe("/assets/index-abc123.js");
  });

  it("a non-API response has none", async () => {
    const res = await get("/login");
    expect(res.status).toBe(200);
    expect(res.headers.get(BUILD_HEADER)).toBeNull();
  });

  it("is omitted when the index has no entry script", async () => {
    fs.writeFileSync(path.join(spaDir, "index.html"), "<html></html>");
    invalidateSpa();
    const res = await get("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get(BUILD_HEADER)).toBeNull();
    fs.writeFileSync(path.join(spaDir, "index.html"), withEntry);
    invalidateSpa();
  });

  it.each([
    ["the hashed entry script", withEntry, "/assets/index-abc123.js"],
    ["the entry among other scripts", `<script src="/assets/chunk-1.js"></script>${withEntry}`, "/assets/index-abc123.js"],
    ["no entry script", "<html></html>", null],
  ])("extractEntry reads %s", (_name, html, expected) => {
    expect(extractEntry(html)).toBe(expected);
  });
});
