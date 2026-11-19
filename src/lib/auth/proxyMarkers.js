// Headers that prove a request passed through a reverse proxy / CDN. A loopback TCP peer
// carrying ANY of these is the proxy hop, not a local operator. Keep in sync with the
// inline copy in custom-server.js (which cannot import from src/).
export const PROXY_MARKER_HEADERS = [
  "x-forwarded-for",
  "x-real-ip",
  "forwarded",
  "x-forwarded-proto",
  "x-forwarded-host",
  "via",
  "cf-connecting-ip",
  "true-client-ip",
];

// TRUST_LOOPBACK_AS_LOCAL=false: operators behind a proxy that sends none of the markers
// (e.g. bare nginx proxy_pass) opt out of loopback-means-local entirely.
export function trustLoopbackAsLocal() {
  return String(process.env.TRUST_LOOPBACK_AS_LOCAL ?? "true").trim().toLowerCase() !== "false";
}

export function hasProxyMarker(headers) {
  return PROXY_MARKER_HEADERS.some((h) => Boolean(headers.get(h)));
}
