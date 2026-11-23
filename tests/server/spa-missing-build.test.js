import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useTempDataDirAtLoad } from "../helpers/tempDataDir.js";
import { mockBootCollaborators } from "../helpers/bootMocks.js";

const spaDir = fs.mkdtempSync(path.join(os.tmpdir(), "lr-spa-missing-"));
const originalSpaDir = process.env.LITEROUTER_SPA_DIR;
process.env.LITEROUTER_SPA_DIR = spaDir;

useTempDataDirAtLoad("lr-spa-missing-data-");
mockBootCollaborators();

const { startServer } = await import("../../src/server/index.js");
const { getSpa, invalidateSpa } = await import("../../src/server/spaBuild.js");
const { updateSettings } = await import("@/lib/db/index.js");

let server;
let base;

const get = (pathname, init = {}) => fetch(`${base}${pathname}`, { redirect: "manual", ...init });

beforeAll(async () => {
  await updateSettings({ requireLogin: false });
  server = await startServer({ port: 0, hostname: "127.0.0.1" });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  if (originalSpaDir === undefined) delete process.env.LITEROUTER_SPA_DIR;
  else process.env.LITEROUTER_SPA_DIR = originalSpaDir;
  fs.rmSync(spaDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe("a missing SPA build", () => {
  it("answers dashboard pages with a plain-text 500, not a crash", async () => {
    const res = await get("/dashboard");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toStartWith("text/plain");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.text()).toContain("The dashboard is not built");
  });

  it("answers /assets/* with the same plain-text 500 and keeps serving public files", async () => {
    const asset = await get("/assets/index-abc.js");
    expect(asset.status).toBe(500);
    expect(await asset.text()).toContain("The dashboard is not built");
    expect((await get("/favicon.svg")).status).toBe(200);
  });

  it("rejects getSpa() with an error naming the directory", async () => {
    await expect(getSpa()).rejects.toThrow("has no index.html");
  });

  it("retries after the build appears: a failure is not memoised", async () => {
    fs.writeFileSync(path.join(spaDir, "index.html"), '<!doctype html><html><head></head><body><div id="root"></div></body></html>');
    const res = await get("/dashboard");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("window.__LR_BOOT__");
  });
});

describe("getSpa memoisation", () => {
  it("concurrent callers share one in-flight promise", async () => {
    invalidateSpa();
    const first = getSpa();
    const second = getSpa();
    expect(second).toBe(first);
    expect((await first).dir).toBe(spaDir);
  });

  it("invalidateSpa drops the memoised value", async () => {
    const before = getSpa();
    invalidateSpa();
    expect(getSpa()).not.toBe(before);
  });
});
