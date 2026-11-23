import { maybeCompress } from "./compress.js";
import { applyCookies } from "./http.js";

const LONG_LIVED_PREFIXES = ["/v1", "/v1beta", "/codex", "/api/v1", "/api/v1beta"];
const LONG_LIVED_EXACT = new Set([
  "/responses",
  "/api/console-logs/stream",
  "/api/usage/stream",
  "/api/pxpipe/install",
  "/api/pxpipe/start",
]);
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export function isLongLived(pathname) {
  if (LONG_LIVED_EXACT.has(pathname)) return true;
  return LONG_LIVED_PREFIXES.some((p) => pathname.startsWith(p));
}

function allowedMethods(mod) {
  const allowed = METHODS.filter((m) => typeof mod[m] === "function");
  if (allowed.includes("GET") && !allowed.includes("HEAD")) allowed.push("HEAD");
  if (!allowed.includes("OPTIONS")) allowed.push("OPTIONS");
  return allowed;
}

function decode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function buildParams(req, route, pathname) {
  const params = {};
  for (const [key, value] of Object.entries(req.params || {})) {
    if (key !== "*") params[key] = String(value);
  }
  if (route.catchAll) {
    const prefix = route.path.endsWith("*") ? route.path.slice(0, -1) : route.path;
    const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
    params[route.catchAll] = rest.split("/").filter(Boolean).map(decode);
  }
  return params;
}

export function toBunHandler(load, route = {}) {
  let loaded;
  const getModule = () => (loaded ||= Promise.resolve().then(load).catch((err) => {
    loaded = undefined;
    throw err;
  }));

  async function dispatch(req, server) {
    const { pathname } = new URL(req.url);
    if (server && isLongLived(pathname)) server.timeout(req, 0);
    const mod = await getModule();
    const allowed = allowedMethods(mod);
    let method = req.method;
    let dropBody = false;
    if (method === "HEAD" && typeof mod.HEAD !== "function" && typeof mod.GET === "function") {
      method = "GET";
      dropBody = true;
    }
    const handler = mod[method];
    if (typeof handler !== "function") {
      if (method === "OPTIONS") return new Response(null, { status: 204, headers: { Allow: allowed.join(", ") } });
      return new Response(null, { status: 405, headers: { Allow: allowed.join(", ") } });
    }
    const params = buildParams(req, route, pathname);
    const handled = await handler(req, { params: Promise.resolve(params) });
    if (!(handled instanceof Response)) throw new TypeError(`route handler ${method} ${pathname} did not return a Response`);
    const res = applyCookies(req, handled);
    if (dropBody) return new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers });
    return res;
  }

  return async (req, server) => {
    try {
      return await maybeCompress(req, await dispatch(req, server));
    } catch (err) {
      console.error("[server] route handler failed:", err);
      return new Response(null, { status: 500 });
    }
  };
}
