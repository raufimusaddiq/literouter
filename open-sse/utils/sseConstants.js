export const SSE_DONE = "data: [DONE]\n\n";

export const SSE_NO_COMPRESS_HEADERS = {
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no"
};

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  ...SSE_NO_COMPRESS_HEADERS,
  "Connection": "keep-alive"
};

export const SSE_HEADERS_NO_BUFFER = {
  "Content-Type": "text/event-stream",
  ...SSE_NO_COMPRESS_HEADERS
};

export const SSE_HEADERS_CORS = {
  ...SSE_HEADERS,
  "Access-Control-Allow-Origin": "*"
};

export function sseResponseHeaders(upstreamHeaders) {
  const out = new Headers(upstreamHeaders || undefined);
  for (const h of ["content-encoding", "content-length", "transfer-encoding"]) out.delete(h);
  for (const [k, v] of Object.entries(SSE_HEADERS)) out.set(k, v);
  return out;
}
