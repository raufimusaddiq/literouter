const MIN_BYTES = 1024;

function isCompressible(type) {
  const t = type.split(";")[0].trim().toLowerCase();
  if (!t || t === "text/event-stream") return false;
  if (t.startsWith("text/")) return true;
  if (t.endsWith("+json") || t.endsWith("+xml")) return true;
  return [
    "application/json",
    "application/javascript",
    "application/x-javascript",
    "application/xml",
    "application/manifest+json",
    "image/svg+xml",
    "image/x-icon",
    "font/ttf",
    "font/otf",
  ].includes(t);
}

function acceptsGzip(req) {
  const header = req.headers.get("accept-encoding") || "";
  return header.split(",").some((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (name.trim() !== "gzip") return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return !q || Number(q.slice(2)) > 0;
  });
}

export async function maybeCompress(req, res) {
  if (!res || res.body === null || req.method === "HEAD") return res;
  if (res.status === 204 || res.status === 304 || res.status === 206) return res;
  if (!acceptsGzip(req)) return res;
  const headers = res.headers;
  if (headers.has("content-encoding")) return res;
  if (!isCompressible(headers.get("content-type") || "")) return res;
  if ((headers.get("cache-control") || "").toLowerCase().includes("no-transform")) return res;
  const declared = headers.get("content-length");
  if (declared !== null && Number(declared) < MIN_BYTES) return res;
  const buffer = new Uint8Array(await res.clone().arrayBuffer());
  if (buffer.byteLength < MIN_BYTES) return res;
  const out = new Headers(headers);
  out.set("Content-Encoding", "gzip");
  out.delete("Content-Length");
  out.append("Vary", "Accept-Encoding");
  return new Response(Bun.gzipSync(buffer), {
    status: res.status,
    statusText: res.statusText,
    headers: out,
  });
}
