import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useTempDataDirAtLoad } from "../helpers/tempDataDir.js";
import { mockBootCollaborators } from "../helpers/bootMocks.js";

useTempDataDirAtLoad("lr-apistatic-");
mockBootCollaborators();

const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "lr-apistatic-pub-"));
fs.mkdirSync(path.join(publicDir, "api"));
fs.writeFileSync(path.join(publicDir, "api", "x.txt"), "api-file");
fs.writeFileSync(path.join(publicDir, "x.txt"), "plain-file");
fs.writeFileSync(path.join(publicDir, "api.txt"), "api-prefixed-file");
const originalPublicDir = process.env.LITEROUTER_PUBLIC_DIR;
process.env.LITEROUTER_PUBLIC_DIR = publicDir;

const { startServer } = await import("../../src/server/index.js");
const { createDashboardAuthToken } = await import("@/lib/auth/dashboardSession");

let server;
let base;
let sessionCookie;

const get = (pathname, init = {}) => fetch(`${base}${pathname}`, { redirect: "manual", ...init });

beforeAll(async () => {
  server = await startServer({ port: 0, hostname: "127.0.0.1" });
  base = `http://127.0.0.1:${server.port}`;
  sessionCookie = `auth_token=${await createDashboardAuthToken()}`;
});

afterAll(() => {
  server.stop(true);
  if (originalPublicDir === undefined) delete process.env.LITEROUTER_PUBLIC_DIR;
  else process.env.LITEROUTER_PUBLIC_DIR = originalPublicDir;
  fs.rmSync(publicDir, { recursive: true, force: true });
});

describe("/api never reaches the static handler", () => {
  it("does not serve a real public/api/x.txt, while x.txt outside /api is served", async () => {
    const headers = { cookie: sessionCookie };
    const plain = await get("/x.txt", { headers });
    expect(plain.status).toBe(200);
    expect(await plain.text()).toBe("plain-file");

    const api = await get("/api/x.txt", { headers });
    expect(api.status).toBe(404);
    expect(api.headers.get("content-type")).toContain("text/html");
    expect(await api.text()).not.toContain("api-file");
  });

  it("only the /api segment is reserved: /api.txt is still a public file", async () => {
    const res = await get("/api.txt", { headers: { cookie: sessionCookie } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("api-prefixed-file");
  });
});
