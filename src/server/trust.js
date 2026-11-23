import { hasProxyMarker, trustLoopbackAsLocal } from "../lib/auth/proxyMarkers.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function isLoopbackAddress(addr) {
  if (!addr) return false;
  let name = String(addr).trim().toLowerCase();
  if (name.startsWith("[")) {
    const end = name.indexOf("]");
    if (end === -1) return false;
    name = name.slice(1, end);
  } else if (name.indexOf(":") !== -1 && name.indexOf(":") === name.lastIndexOf(":")) {
    name = name.slice(0, name.indexOf(":"));
  }
  if (name.startsWith("::ffff:")) name = name.slice(7);
  return LOOPBACK_HOSTS.has(name);
}

export function deriveClientIp(peerIp, headers) {
  if (!isLoopbackAddress(peerIp)) return peerIp;
  const realIp = (headers.get("x-real-ip") || "").trim();
  if (realIp) return realIp;
  const hops = (headers.get("x-forwarded-for") || "").split(",").map((h) => h.trim()).filter(Boolean);
  if (hops.length) return hops[hops.length - 1];
  return peerIp;
}

function hasLoopbackOrigin(headers) {
  const origin = headers.get("origin");
  if (!origin) return true;
  try {
    return isLoopbackAddress(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function buildRequestContext(peerIp, headers) {
  const isLocal =
    trustLoopbackAsLocal() &&
    !hasProxyMarker(headers) &&
    isLoopbackAddress(peerIp) &&
    hasLoopbackOrigin(headers);
  return { peerIp, clientIp: deriveClientIp(peerIp, headers), isLocal };
}
