import { isAbsolute, relative, resolve, sep } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { PUBLIC_DIR } from "./paths.js";

const CACHE_CONTROL = "public, max-age=0";
const CONTENT_TYPES = { ".webmanifest": "application/manifest+json" };

function resolveRequestPath(req) {
  let decoded;
  try {
    decoded = decodeURIComponent(new URL(req.url).pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\") || decoded.includes(":")) return null;
  const segments = decoded.split("/").slice(1);
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  const target = resolve(PUBLIC_DIR, ...segments);
  return target.startsWith(PUBLIC_DIR + sep) ? target : null;
}

async function staysInsideRoot(target) {
  try {
    const rel = relative(await realpath(PUBLIC_DIR), await realpath(target));
    return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  } catch {
    return false;
  }
}

function contentTypeOf(target, file) {
  const dot = target.lastIndexOf(".");
  return (dot >= 0 && CONTENT_TYPES[target.slice(dot).toLowerCase()]) || file.type;
}

export async function serveStatic(req) {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const target = resolveRequestPath(req);
  if (!target) return null;
  let info;
  try {
    info = await stat(target);
  } catch {
    return null;
  }
  if (!info.isFile()) return null;
  if (!(await staysInsideRoot(target))) return null;
  const file = Bun.file(target);
  const headers = {
    "content-type": contentTypeOf(target, file),
    "cache-control": CACHE_CONTROL,
    "content-length": String(info.size),
  };
  return new Response(req.method === "HEAD" ? null : file, { status: 200, headers });
}
