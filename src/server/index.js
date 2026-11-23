import { routeTable } from "./routes.js";
import { toBunHandler } from "./adapter.js";
import { maybeCompress } from "./compress.js";
import { setRequestContext } from "./context.js";
import { buildRequestContext } from "./trust.js";
import { guard } from "./guard.js";
import { notFound } from "./notFound.js";
import { runBootOnce } from "./boot.js";
import { serveSpa } from "./spa.js";
import { serveStatic } from "./static.js";

const MAX_BODY_BYTES = 128 * 1024 * 1024;
const IDLE_TIMEOUT_SECONDS = 255;
const STRIPPED_HEADERS = ["x-9r-real-ip", "x-9r-peer-token", "x-9r-via-proxy", "x-forwarded-for"];

function isSpaPath(pathname) {
  return pathname === "/" || pathname === "/login" || pathname === "/callback" ||
    pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}

function trailingSlashRedirect(url) {
  if (url.pathname.length <= 1 || !url.pathname.endsWith("/")) return null;
  const path = "/" + url.pathname.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  const target = (path.replace(/\/$/, "") || "/") + url.search;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(target));
      controller.close();
    },
  });
  return new Response(body, {
    status: 308,
    headers: { Location: target, Refresh: `0;url=${target}` },
  });
}

async function fallback(req) {
  const { pathname } = new URL(req.url);
  if (pathname === "/api" || pathname.startsWith("/api/")) return notFound(req);
  const readOnly = req.method === "GET" || req.method === "HEAD";
  if (readOnly && isSpaPath(pathname)) return serveSpa(req);
  if (readOnly) {
    const res = await serveStatic(req);
    if (res) return res;
  }
  return notFound(req);
}

async function serve(req, server, inner) {
  try {
    const redirect = trailingSlashRedirect(new URL(req.url));
    if (redirect) return redirect;
    setRequestContext(req, buildRequestContext(server.requestIP(req)?.address ?? "", req.headers));
    for (const name of STRIPPED_HEADERS) req.headers.delete(name);
    const blocked = await guard(req);
    if (blocked) return await maybeCompress(req, blocked);
    return await inner(req, server);
  } catch (err) {
    console.error("[server] request failed:", err);
    return new Response(null, { status: 500 });
  }
}

function guarded(handler) {
  if (typeof handler === "function") return (req, server) => serve(req, server, handler);
  if (handler && typeof handler === "object" && !(handler instanceof Response)) {
    return Object.fromEntries(Object.entries(handler).map(([method, fn]) => [method, guarded(fn)]));
  }
  return handler;
}

function buildRoutes(extra) {
  const routes = {};
  for (const entry of routeTable) routes[entry.path] = guarded(toBunHandler(entry.load, entry));
  for (const [path, handler] of Object.entries(extra)) routes[path] = guarded(handler);
  return routes;
}

function onError(err) {
  console.error("[server] unhandled error:", err);
  return new Response(null, { status: 500 });
}

export async function startServer({
  port = Number(process.env.PORT) || 20128,
  hostname = process.env.HOSTNAME || "0.0.0.0",
  routes: extra = {},
} = {}) {
  await runBootOnce();
  const options = {
    port,
    hostname,
    idleTimeout: IDLE_TIMEOUT_SECONDS,
    maxRequestBodySize: MAX_BODY_BYTES,
    routes: buildRoutes(extra),
    fetch: (req, server) => serve(req, server, async (r) => maybeCompress(r, await fallback(r))),
    error: onError,
  };
  if (import.meta.hot && globalThis.__lrServer) {
    globalThis.__lrServer.reload(options);
    return globalThis.__lrServer;
  }
  const server = Bun.serve(options);
  globalThis.__lrServer = server;
  return server;
}

if (import.meta.main) {
  const server = await startServer();
  console.log(`LiteRouter listening on http://${server.hostname}:${server.port}`);
}
