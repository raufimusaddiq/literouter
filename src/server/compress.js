import { promisify } from "node:util";
import { brotliCompress, constants, createGzip, gzip } from "node:zlib";

const COMPRESSIBLE_TYPES = new Set([
  "application/json",
  "application/javascript",
  "application/x-javascript",
  "application/ecmascript",
  "application/xml",
  "application/graphql",
  "application/graphql+json",
  "application/wasm",
  "application/x-httpd-php",
  "application/x-sh",
  "application/x-www-form-urlencoded",
  "application/x-yaml",
  "application/yaml",
  "application/vnd.ms-fontobject",
  "application/x-font-ttf",
  "image/bmp",
  "image/svg+xml",
  "image/vnd.microsoft.icon",
  "image/x-icon",
  "font/ttf",
  "font/otf",
  "font/opentype",
]);

export const MIN_DECLARED_BYTES = 1024;

const NEVER_COMPRESSED = new Set(["text/event-stream", "application/x-ndjson"]);

export function isCompressible(type) {
  const t = type.split(";")[0].trim().toLowerCase();
  if (!t || NEVER_COMPRESSED.has(t)) return false;
  if (t.startsWith("text/")) return true;
  if (/\+(?:json|text|xml)$/.test(t)) return true;
  return COMPRESSIBLE_TYPES.has(t);
}

function accepts(req, encoding) {
  const header = req.headers.get("accept-encoding") || "";
  return header.split(",").some((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (name.trim() !== encoding) return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return !q || Number(q.slice(2)) > 0;
  });
}

const ENCODERS = {
  br: (bytes) => promisify(brotliCompress)(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 10, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength } }),
  gzip: (bytes) => promisify(gzip)(bytes, { level: 9 }),
};
const ASSET_CACHE_LIMIT = 256;
const assetCache = new Map();

export function assetEncoding(req) {
  if (accepts(req, "br")) return "br";
  if (accepts(req, "gzip")) return "gzip";
  return null;
}

export function encodedAsset(key, encoding, read) {
  const cacheKey = `${encoding}|${key}`;
  let hit = assetCache.get(cacheKey);
  if (!hit) {
    hit = read().then((bytes) => ENCODERS[encoding](bytes)).then((out) => new Uint8Array(out));
    hit.catch(() => assetCache.delete(cacheKey));
    assetCache.set(cacheKey, hit);
    if (assetCache.size > ASSET_CACHE_LIMIT) assetCache.delete(assetCache.keys().next().value);
  }
  return hit;
}

function gzipStream(body) {
  const gz = createGzip();
  let reader = null;
  return new ReadableStream({
    start(controller) {
      gz.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk)));
      gz.on("end", () => controller.close());
      gz.on("error", (err) => controller.error(err));
    },
    async pull() {
      reader ??= body.getReader();
      let step;
      try {
        step = await reader.read();
      } catch (err) {
        gz.destroy(err);
        return;
      }
      if (step.done) {
        gz.end();
        return;
      }
      gz.write(step.value);
      await new Promise((resolve) => gz.flush(constants.Z_SYNC_FLUSH, resolve));
    },
    cancel(reason) {
      gz.destroy();
      return reader ? reader.cancel(reason) : body.cancel(reason);
    },
  });
}

export async function maybeCompress(req, res) {
  if (!res || res.body === null || req.method === "HEAD") return res;
  if (res.status === 204 || res.status === 304 || res.status === 206) return res;
  if (!accepts(req, "gzip")) return res;
  const headers = res.headers;
  if (headers.has("content-encoding")) return res;
  if (!isCompressible(headers.get("content-type") || "")) return res;
  if ((headers.get("cache-control") || "").toLowerCase().includes("no-transform")) return res;
  const declared = headers.get("content-length");
  if (declared !== null && Number(declared) < MIN_DECLARED_BYTES) return res;
  const out = new Headers(headers);
  const etag = out.get("etag");
  if (etag && !etag.startsWith("W/")) out.set("ETag", `W/${etag}`);
  out.set("Content-Encoding", "gzip");
  out.delete("Content-Length");
  out.append("Vary", "Accept-Encoding");
  return new Response(gzipStream(res.body), {
    status: res.status,
    statusText: res.statusText,
    headers: out,
  });
}
