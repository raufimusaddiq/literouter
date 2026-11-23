import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useTempDataDirAtLoad } from "../helpers/tempDataDir.js";
import { mockBootCollaborators } from "../helpers/bootMocks.js";

const spaDir = fs.mkdtempSync(path.join(os.tmpdir(), "lr-spa-dash-"));
const originalSpaDir = process.env.LITEROUTER_SPA_DIR;
const originalGaId = process.env.NEXT_PUBLIC_GA_ID;
process.env.LITEROUTER_SPA_DIR = spaDir;
delete process.env.NEXT_PUBLIC_GA_ID;

useTempDataDirAtLoad("lr-spa-dash-data-");
mockBootCollaborators();

const { buildWeb } = await import("../../src/web/build.js");
const { routes } = await import("../../src/web/routes.js");
const { startServer } = await import("../../src/server/index.js");
const { updateSettings } = await import("@/lib/db/index.js");
const { PROVIDER_ICON_IDS } = await import("@/shared/constants/providerIconManifest.js");

let server;
let base;

const get = (pathname, init = {}) => fetch(`${base}${pathname}`, { redirect: "manual", ...init });

function bootScript(html) {
  const start = html.indexOf("window.__LR_BOOT__=");
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</script>", start));
}

beforeAll(async () => {
  await buildWeb({ production: true, outdir: spaDir });
  await updateSettings({ requireLogin: false });
  server = await startServer({ port: 0, hostname: "127.0.0.1" });
  base = `http://127.0.0.1:${server.port}`;
}, 180_000);

afterEach(() => {
  delete process.env.NEXT_PUBLIC_GA_ID;
});

afterAll(() => {
  server.stop(true);
  if (originalSpaDir === undefined) delete process.env.LITEROUTER_SPA_DIR;
  else process.env.LITEROUTER_SPA_DIR = originalSpaDir;
  if (originalGaId === undefined) delete process.env.NEXT_PUBLIC_GA_ID;
  else process.env.NEXT_PUBLIC_GA_ID = originalGaId;
  fs.rmSync(spaDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe("SPA pages", () => {
  const spaPaths = routes
    .filter((route) => !route.redirect)
    .map((route) => route.path.replace(":id", "openai"));
  spaPaths.push("/dashboard/providers/a%2Fb");

  it("every SPA route returns index.html with boot data", async () => {
    for (const pathname of spaPaths) {
      const res = await get(pathname);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toStartWith("text/html");
      expect(res.headers.get("cache-control")).toContain("no-store");
      const html = await res.text();
      expect(html).toContain("window.__LR_BOOT__");
      expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
      expect(html).toMatch(/<script[^>]+src="\/assets\/index-[^"]+\.js"/);
    }
  });

  it("a trailing slash redirects to the slashless path, which serves the SPA", async () => {
    const redirect = await get("/dashboard/providers/openai/");
    expect(redirect.status).toBe(308);
    const res = await get("/dashboard/providers/openai/", { redirect: "follow" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("window.__LR_BOOT__");
  });

  it("/ redirects to /dashboard", async () => {
    const res = await get("/");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toEndWith("/dashboard");
  });

  it("unauthenticated dashboard request redirects to /login and carries no boot data", async () => {
    await updateSettings({ requireLogin: true });
    try {
      const res = await get("/dashboard/providers");
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("/login");
      expect(await res.text()).not.toContain("__LR_BOOT__");
    } finally {
      await updateSettings({ requireLogin: false });
    }
  });

  it("boot values are escaped", async () => {
    process.env.NEXT_PUBLIC_GA_ID = "</script><!--  ";
    const res = await get("/login", { headers: { cookie: "locale=</script><!--" } });
    const script = bootScript(await res.text());
    expect(script).not.toContain("</script");
    expect(script).not.toContain("<!--");
    expect(script).not.toContain(" ");
    expect(script).not.toContain(" ");
  });

  it("no analytics tag when the id is unset", async () => {
    const html = await (await get("/login")).text();
    expect(html).not.toContain("googletagmanager");
  });

  it("the analytics tag appears for a valid id", async () => {
    process.env.NEXT_PUBLIC_GA_ID = "G-TEST123";
    const html = await (await get("/login")).text();
    expect(html).toContain("googletagmanager.com/gtag/js?id=G-TEST123");
  });
});

describe("assets and public files", () => {
  it("every asset referenced by index.html resolves", async () => {
    const html = fs.readFileSync(path.join(spaDir, "index.html"), "utf8");
    const urls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
    expect(urls.length).toBeGreaterThan(1);
    for (const url of urls) {
      const res = await get(url);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toContain("immutable");
      if (url.endsWith(".js")) expect(res.headers.get("content-type")).toContain("text/javascript");
      if (url.endsWith(".css")) expect(res.headers.get("content-type")).toContain("text/css");
      await res.arrayBuffer();
    }
  });

  it("every provider icon in the manifest is served", async () => {
    for (const id of PROVIDER_ICON_IDS) {
      const res = await get(`/providers/${id}.png`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
      await res.arrayBuffer();
    }
  });

  it("public files keep their paths", async () => {
    const expectations = [
      ["/favicon.svg", "image/svg+xml"],
      ["/icons/icon-192.svg", "image/svg+xml"],
      ["/icons/icon-512.svg", "image/svg+xml"],
      ["/sw.js", "javascript"],
      ["/i18n/literals/vi.json", "application/json"],
      ["/manifest.webmanifest", "application/manifest+json"],
    ];
    for (const [pathname, type] of expectations) {
      const res = await get(pathname);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain(type);
    }
    const literals = await (await get("/i18n/literals/vi.json")).json();
    expect(typeof literals).toBe("object");
    const manifest = await (await get("/manifest.webmanifest")).json();
    expect(manifest.name).toBe("LiteRouter — AI routing control plane");
    expect(manifest.icons).toHaveLength(3);
  });

  it("missing static paths are 404, never index.html", async () => {
    for (const pathname of ["/assets/nope.js", "/providers/nope.png", "/i18n/literals/zz.json"]) {
      const res = await get(pathname);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("__LR_BOOT__");
    }
  });

  it("traversal is refused", async () => {
    for (const pathname of ["/..%2f..%2fpackage.json", "/%2e%2e/package.json", "/icons/..%5c..%5cpackage.json", "/assets/..%2findex.html", "/assets/%2e%2e/index.html"]) {
      const res = await get(pathname);
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).not.toContain('"dependencies"');
      expect(body).not.toContain("__LR_BOOT__");
    }
  });

  it("unknown api path stays JSON 404", async () => {
    const res = await get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("__LR_BOOT__");
  });

  it("HEAD on an asset has no body", async () => {
    const html = fs.readFileSync(path.join(spaDir, "index.html"), "utf8");
    const url = html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
    const head = await get(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(Number(head.headers.get("content-length"))).toBeGreaterThan(0);
    expect(await head.text()).toBe("");
  });
});
