export function encodeDataUri(mimeType, base64) {
  return `data:${mimeType};base64,${base64}`;
}

const DATA_URI_RE = /^data:([^;]+);base64,([\s\S]+)$/;
export function parseDataUri(url) {
  if (typeof url !== "string") return null;
  const m = url.match(DATA_URI_RE);
  return m ? { mimeType: m[1], base64: m[2] } : null;
}

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { MAX_IMAGE_BYTES, MAX_REMOTE_IMAGES_PER_REQUEST, MAX_TOTAL_IMAGE_BYTES, FETCH_TIMEOUT_MS, IMAGE_SIGNATURES, BLOCKED_HOSTS } from "../../config/mediaConfig.js";

const blockList = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4], ["255.255.255.255", 32],
]) blockList.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["2001::", 32], ["2001:db8::", 32], ["2002::", 16],
  ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
]) blockList.addSubnet(net, prefix, "ipv6");

export function isPrivateIp(ip) {
  if (!ip || typeof ip !== "string") return true;
  const addr = ip.split("%")[0];
  const family = isIP(addr);
  if (!family) return true;
  if (family === 6) {
    const m = addr.toLowerCase().match(/^(?:0{0,4}:){0,5}ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
    if (m) {
      const v4 = m[1] || `${parseInt(m[2], 16) >> 8}.${parseInt(m[2], 16) & 255}.${parseInt(m[3], 16) >> 8}.${parseInt(m[3], 16) & 255}`;
      return isPrivateIp(v4);
    }
  }
  return blockList.check(addr, family === 4 ? "ipv4" : "ipv6");
}

async function resolvePinnedIps(hostname) {
  if (!hostname || BLOCKED_HOSTS.has(hostname.toLowerCase())) return null;
  try {
    const records = await lookup(hostname, { all: true });
    if (!records.length || records.some((r) => isPrivateIp(r.address))) return null;
    return records;
  } catch {
    return null;
  }
}

function detectImageMime(buf) {
  for (const { sig, offset, mime, verifyWebp } of IMAGE_SIGNATURES) {
    if (buf.length < offset + sig.length) continue;
    let match = true;
    for (let i = 0; i < sig.length; i++) {
      if (buf[offset + i] !== sig[i]) { match = false; break; }
    }
    if (!match) continue;
    if (verifyWebp && !(buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50)) continue;
    return mime;
  }
  return null;
}

export async function fetchImageAsBase64(imageUrl, options = {}) {
  const { signal, timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_IMAGE_BYTES } = options;
  if (!imageUrl || (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://"))) {
    return null;
  }

  let url;
  try { url = new URL(imageUrl); } catch { return null; }
  const pinnedIps = await resolvePinnedIps(url.hostname);
  if (!pinnedIps) return null;

  const controller = new AbortController();
  const timeout = signal ? null : setTimeout(() => controller.abort(), timeoutMs);
  const fetchSignal = signal || controller.signal;

  const pinned = pinnedIps[0];
  const pinnedHost = pinned.family === 6 || isIP(pinned.address) === 6 ? `[${pinned.address}]` : pinned.address;
  const pinnedUrl = `${url.protocol}//${pinnedHost}${url.port ? `:${url.port}` : ""}${url.pathname}${url.search}`;
  const init = { headers: { Host: url.host }, signal: fetchSignal, redirect: "manual" };
  if (url.protocol === "https:") init.tls = { serverName: url.hostname };

  try {
    const response = await fetch(pinnedUrl, init);
    if (!response.ok || !response.body) return null;

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) { try { await reader.cancel(); } catch {} return null; }
      chunks.push(value);
    }

    const buf = Buffer.concat(chunks, total);
    const mimeType = detectImageMime(buf);
    if (!mimeType) return null;

    return { url: `data:${mimeType};base64,${buf.toString("base64")}`, mimeType };
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class ImageLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImageLimitError";
    this.code = "IMAGE_LIMIT_EXCEEDED";
    this.status = 400;
  }
}

export function assertImageCount(count, max = MAX_REMOTE_IMAGES_PER_REQUEST) {
  if (count > max) throw new ImageLimitError(`Image limit exceeded: ${count} remote images in one request (max ${max})`);
}

export function dataUriBytes(dataUri) {
  const b64 = typeof dataUri === "string" ? dataUri.slice(dataUri.indexOf(",") + 1) : "";
  return Math.floor((b64.length * 3) / 4);
}

export function createImageByteBudget(max = MAX_TOTAL_IMAGE_BYTES) {
  let total = 0;
  return {
    add(bytes) {
      total += bytes;
      if (total > max) throw new ImageLimitError(`Image limit exceeded: remote images exceed ${Math.floor(max / 1024 / 1024)}MB total per request`);
    },
  };
}

export async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
