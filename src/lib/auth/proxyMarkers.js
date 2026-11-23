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

export function trustLoopbackAsLocal() {
  return String(process.env.TRUST_LOOPBACK_AS_LOCAL ?? "true").trim().toLowerCase() !== "false";
}

export function hasProxyMarker(headers) {
  return PROXY_MARKER_HEADERS.some((h) => Boolean(headers.get(h)));
}
