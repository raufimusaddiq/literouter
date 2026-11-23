import { afterAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useTempDataDirAtLoad } from "../helpers/tempDataDir.js";
import { mockBootCollaborators } from "../helpers/bootMocks.js";

const spaDir = fs.mkdtempSync(path.join(os.tmpdir(), "lr-smoke-spa-"));
fs.writeFileSync(path.join(spaDir, "index.html"), "<!doctype html><html><head></head><body></body></html>");
const originalEnv = {
  LITEROUTER_SPA_DIR: process.env.LITEROUTER_SPA_DIR,
  INITIAL_PASSWORD: process.env.INITIAL_PASSWORD,
  AUTH_COOKIE_SECURE: process.env.AUTH_COOKIE_SECURE,
};
process.env.LITEROUTER_SPA_DIR = spaDir;
process.env.INITIAL_PASSWORD = "smoke-pass";
process.env.AUTH_COOKIE_SECURE = "false";

useTempDataDirAtLoad("lr-smoke-data-");
mockBootCollaborators();

const { startServer } = await import("../../src/server/index.js");
const { runSmoke } = await import("../../scripts/smoke-server.mjs");

let server;
let broken;


afterAll(() => {
  server?.stop(true);
  broken?.stop(true);
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(spaDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe("smoke script", () => {
  it("smoke passes against the source server", async () => {
    server = await startServer({ port: 0, hostname: "127.0.0.1" });
    const result = await runSmoke({ base: `http://127.0.0.1:${server.port}` });
    expect(result).toEqual({ health: 200, dashboard: 200, chat: 200, chatText: "smoke-ok" });
  });

  it("smoke fails loudly when /v1 is broken", async () => {
    const real = server;
    broken = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.startsWith("/v1/")) return new Response("boom", { status: 500 });
        const headers = new Headers(req.headers);
        headers.delete("accept-encoding");
        return fetch(`http://127.0.0.1:${real.port}${url.pathname}${url.search}`, {
          method: req.method,
          headers,
          body: req.body,
          redirect: "manual",
        }).then((res) => {
          const out = new Headers(res.headers);
          out.delete("content-encoding");
          out.delete("content-length");
          return new Response(res.body, { status: res.status, headers: out });
        });
      },
    });
    await expect(runSmoke({ base: `http://127.0.0.1:${broken.port}` })).rejects.toThrow("/v1/chat/completions");
  });
});
