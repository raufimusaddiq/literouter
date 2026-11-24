import { isAbsolute, relative, resolve, sep } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { PUBLIC_DIR, isCompiled, isEmbeddedPath } from "./paths.js";
import { getSpa, spaUnavailableResponse } from "./spaBuild.js";
import { MIN_DECLARED_BYTES, assetEncoding, encodedAsset, isCompressible } from "./compress.js";

const PUBLIC_CACHE_CONTROL = "public, max-age=0";
const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const ASSETS_PREFIX = "/assets/";
const CONTENT_TYPES = { ".webmanifest": "application/manifest+json" };

function decodeSegments(req) {
  let decoded;
  try {
    decoded = decodeURIComponent(new URL(req.url).pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\") || decoded.includes(":")) return null;
  const segments = decoded.split("/").slice(1);
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  return segments;
}

function resolveIn(root, segments) {
  const target = resolve(root, ...segments);
  return target.startsWith(root + sep) ? target : null;
}

async function staysInsideRoot(root, target) {
  if (isCompiled && isEmbeddedPath(root)) return true;
  try {
    const rel = relative(await realpath(root), await realpath(target));
    return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  } catch {
    return false;
  }
}

function contentTypeOf(target, file) {
  const dot = target.lastIndexOf(".");
  return (dot >= 0 && CONTENT_TYPES[target.slice(dot).toLowerCase()]) || file.type;
}

async function encodedResponse(req, target, file, info, headers) {
  if (req.method === "HEAD" || info.size < MIN_DECLARED_BYTES || !isCompressible(headers["content-type"])) return null;
  const encoding = assetEncoding(req);
  if (!encoding) return null;
  const bytes = await encodedAsset(`${target}|${info.size}|${info.mtimeMs}`, encoding, () => file.bytes());
  return new Response(bytes, {
    status: 200,
    headers: { ...headers, "content-encoding": encoding, "content-length": String(bytes.byteLength), vary: "Accept-Encoding" },
  });
}

async function serveFrom(req, root, segments, cacheControl) {
  const target = resolveIn(root, segments);
  if (!target) return null;
  let info;
  try {
    info = await stat(target);
  } catch {
    return null;
  }
  if (!info.isFile()) return null;
  if (!(await staysInsideRoot(root, target))) return null;
  const file = Bun.file(target);
  const headers = {
    "content-type": contentTypeOf(target, file),
    "cache-control": cacheControl,
    "content-length": String(info.size),
  };
  if (cacheControl === ASSET_CACHE_CONTROL) {
    const encoded = await encodedResponse(req, target, file, info, headers);
    if (encoded) return encoded;
  }
  return new Response(req.method === "HEAD" ? null : file, { status: 200, headers });
}

export async function serveStatic(req) {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const segments = decodeSegments(req);
  if (!segments) return null;
  if (new URL(req.url).pathname.startsWith(ASSETS_PREFIX)) {
    let spa;
    try {
      spa = await getSpa();
    } catch (error) {
      return spaUnavailableResponse(error);
    }
    return serveFrom(req, spa.dir, segments, ASSET_CACHE_CONTROL);
  }
  return serveFrom(req, PUBLIC_DIR, segments, PUBLIC_CACHE_CONTROL);
}
