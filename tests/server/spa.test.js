import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { useTempDataDirAtLoad } from "../helpers/tempDataDir.js";
import { mockBootCollaborators } from "../helpers/bootMocks.js";

const spaDir = fs.mkdtempSync(path.join(os.tmpdir(), "lr-spa-fixture-"));
fs.writeFileSync(
  path.join(spaDir, "index.html"),
  '<!doctype html><html><head><title>LiteRouter</title></head><body><div id="root"></div></body></html>',
);
const originalSpaDir = process.env.LITEROUTER_SPA_DIR;
process.env.LITEROUTER_SPA_DIR = spaDir;

useTempDataDirAtLoad("lr-spa-");
mockBootCollaborators();

const { startServer } = await import("../../src/server/index.js");
const { serializeBoot } = await import("../../src/server/spa.js");
const { updateSettings } = await import("@/lib/db/index.js");
const { createDashboardAuthToken } = await import("@/lib/auth/dashboardSession");
const { getServerTimeZone } = await import("@/shared/utils/dateTime");

let server;
let base;
let sessionCookie;
const originalGaId = process.env.NEXT_PUBLIC_GA_ID;

function readBoot(html) {
  const match = html.match(/window\.__LR_BOOT__=(\{.*?\})<\/script>/s);
  expect(match).not.toBeNull();
  return JSON.parse(match[1]);
}

function rawRequest(path, method = "GET") {
  return new Promise((resolve, reject) => {
    const socket = net.connect(server.port, "127.0.0.1");
    let data = "";
    socket.setTimeout(10_000, () => socket.destroy(new Error("raw request timed out")));
    socket.on("data", (chunk) => {
      data += chunk.toString("latin1");
    });
    socket.on("error", reject);
    socket.on("close", () => resolve({ status: Number(data.split(" ")[1]), raw: data }));
    socket.write(`${method} ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
  });
}

const get = (path, init = {}) => fetch(`${base}${path}`, { redirect: "manual", ...init });

beforeAll(async () => {
  server = await startServer({ port: 0, hostname: "127.0.0.1" });
  base = `http://127.0.0.1:${server.port}`;
  sessionCookie = `auth_token=${await createDashboardAuthToken()}`;
  await updateSettings({ requireLogin: true });
});

afterEach(async () => {
  if (originalGaId === undefined) delete process.env.NEXT_PUBLIC_GA_ID;
  else process.env.NEXT_PUBLIC_GA_ID = originalGaId;
  await updateSettings({ requireLogin: true });
});

afterAll(() => {
  server?.stop(true);
  if (originalSpaDir === undefined) delete process.env.LITEROUTER_SPA_DIR;
  else process.env.LITEROUTER_SPA_DIR = originalSpaDir;
  fs.rmSync(spaDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe("SPA placeholder", () => {
  it("unauthenticated /dashboard redirects to /login", async () => {
    const res = await get("/dashboard");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("/ redirects to /dashboard", async () => {
    const res = await get("/");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/dashboard");
  });

  it("/login and /callback serve the SPA without a session", async () => {
    for (const path of ["/login", "/callback"]) {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain('<div id="root">');
      expect(html).toContain("window.__LR_BOOT__=");
    }
  });

  it("/dashboard/providers/abc serves index.html after login", async () => {
    const res = await get("/dashboard/providers/abc", { headers: { cookie: sessionCookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain('<div id="root">');
    const denied = await get("/dashboard/providers/abc");
    expect(denied.status).toBe(307);
  });

  it("/dashboard serves the SPA without a session when requireLogin is off", async () => {
    await updateSettings({ requireLogin: false });
    const res = await get("/dashboard");
    expect(res.status).toBe(200);
    expect(readBoot(await res.text()).requireLogin).toBe(false);
  });

  it("boot values are injected: timeZone, gaId, requireLogin, locale", async () => {
    process.env.NEXT_PUBLIC_GA_ID = "G-TEST123";
    const res = await get("/login", { headers: { cookie: "locale=vi" } });
    const boot = readBoot(await res.text());
    expect(Object.keys(boot).sort()).toEqual(["gaId", "locale", "requireLogin", "timeZone"]);
    expect(boot).toEqual({
      timeZone: getServerTimeZone(),
      gaId: "G-TEST123",
      requireLogin: true,
      locale: "vi",
    });
  });

  it("boot defaults: gaId null, locale en", async () => {
    delete process.env.NEXT_PUBLIC_GA_ID;
    const boot = readBoot(await (await get("/login")).text());
    expect(boot.gaId).toBeNull();
    expect(boot.locale).toBe("en");
  });

  it("the boot script is the last child of <head>", async () => {
    const html = await (await get("/login")).text();
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    expect(head.trimEnd().endsWith("</script>")).toBe(true);
    expect(head.lastIndexOf("window.__LR_BOOT__=")).toBeGreaterThan(head.lastIndexOf("<title>"));
  });

  it("a hostile locale cookie cannot break out of the script tag", async () => {
    const res = await get("/login", { headers: { cookie: "locale=</script><script>alert(1)" } });
    const html = await res.text();
    expect(html).not.toContain("<script>alert(1)");
    expect(readBoot(html).locale).toBe("en");
  });

  it("a hostile boot value is escaped and round-trips", async () => {
    const hostile = "</script><script>alert(1)&\u2028\u2029";
    process.env.NEXT_PUBLIC_GA_ID = hostile;
    const html = await (await get("/login")).text();
    expect(html).not.toContain("<script>alert(1)");
    const start = html.indexOf("window.__LR_BOOT__=");
    const scriptBody = html.slice(start, html.indexOf("</script>", start));
    expect(scriptBody).not.toMatch(/[<>&\u2028\u2029]/);
    expect(readBoot(html).gaId).toBe(hostile);
  });

  it("serializeBoot escapes <, >, &, U+2028 and U+2029", () => {
    const out = serializeBoot({ gaId: "<>&\u2028\u2029" });
    expect(out).toBe('{"gaId":"\\u003c\\u003e\\u0026\\u2028\\u2029"}');
    expect(JSON.parse(out).gaId).toBe("<>&\u2028\u2029");
  });

  it("HEAD on a SPA path returns headers without a body", async () => {
    const res = await get("/login", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");
  });

  it("non-GET on a SPA path is 404", async () => {
    const res = await get("/login", { method: "POST", body: "x" });
    expect(res.status).toBe(404);
  });
});

describe("static files", () => {
  it("public files are served and ../ traversal is 404", async () => {
    const icon = await get("/favicon.svg");
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toContain("image/svg+xml");
    expect(icon.headers.get("cache-control")).toBe("public, max-age=0");
    expect(await icon.text()).toContain("<svg");
    const icon192 = await get("/icons/icon-192.svg");
    expect(icon192.status).toBe(200);
    expect(icon192.headers.get("content-type")).toContain("image/svg+xml");
    const shapes = [
      "/%2e%2e/package.json",
      "/..%2fpackage.json",
      "/icons/..%2f..%2fpackage.json",
      "/icons/%2e%2e%2f%2e%2e%2fpackage.json",
      "/..%5cpackage.json",
      "/icons/..%5c..%5cpackage.json",
      "/%00",
      "/favicon.svg%00.png",
    ];
    for (const shape of shapes) {
      const res = await rawRequest(shape);
      expect(res.status).toBe(404);
    }
  });

  it("the query string is ignored (favicon.svg?v=2)", async () => {
    const res = await get("/favicon.svg?v=2");
    expect(res.status).toBe(200);
  });

  it("HEAD returns the headers of a GET without a body", async () => {
    const head = await get("/favicon.svg", { method: "HEAD" });
    const full = await get("/favicon.svg");
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe(full.headers.get("content-type"));
    expect(head.headers.get("content-length")).toBe(full.headers.get("content-length"));
    expect(await head.text()).toBe("");
  });

  it("directories are not listed", async () => {
    for (const path of ["/icons", "/providers", "/i18n"]) {
      expect((await get(path)).status).toBe(404);
    }
  });

  it("non-GET methods on a public file are 404", async () => {
    expect((await get("/favicon.svg", { method: "POST", body: "x" })).status).toBe(404);
  });

  it("/api/* never reaches the static handler", async () => {
    const res = await get("/api/favicon.svg", { headers: { cookie: sessionCookie } });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("/manifest.webmanifest has the manifest content type", async () => {
    const res = await get("/manifest.webmanifest");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/manifest+json");
    const manifest = await res.json();
    expect(manifest.name).toBe("LiteRouter — AI routing control plane");
    expect(manifest.short_name).toBe("LiteRouter");
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons).toHaveLength(3);
  });

  it("unknown non-dashboard path is 404", async () => {
    const res = await get("/nope");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("This page could not be found.");
  });
});
