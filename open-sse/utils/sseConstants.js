// Shared SSE primitives (no imports → safe for executors + stream.js)
export const SSE_DONE = "data: [DONE]\n\n";

// Compression/buffering guards for every streamed response.
// Next's route-handler compression (the `compression` middleware) skips a response when
// Cache-Control has `no-transform` (`Content-Encoding: identity` does NOT block it);
// X-Accel-Buffering stops nginx-style proxies from buffering the stream.
export const SSE_NO_COMPRESS_HEADERS = {
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no"
};

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  ...SSE_NO_COMPRESS_HEADERS,
  "Connection": "keep-alive"
};

// Variant for web-cookie executors behind nginx (disable proxy buffering)
export const SSE_HEADERS_NO_BUFFER = {
  "Content-Type": "text/event-stream",
  ...SSE_NO_COMPRESS_HEADERS
};

// Variant for client-facing SSE responses (adds permissive CORS)
export const SSE_HEADERS_CORS = {
  ...SSE_HEADERS,
  "Access-Control-Allow-Origin": "*"
};

// Headers for a re-streamed upstream response: keep upstream headers, but drop the ones that
// describe the upstream wire encoding (body is already decoded) and force the SSE guards.
export function sseResponseHeaders(upstreamHeaders) {
  const out = new Headers(upstreamHeaders || undefined);
  for (const h of ["content-encoding", "content-length", "transfer-encoding"]) out.delete(h);
  for (const [k, v] of Object.entries(SSE_HEADERS)) out.set(k, v);
  return out;
}
