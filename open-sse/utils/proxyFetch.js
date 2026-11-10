import {
  MEMORY_CONFIG,
  FRESH_RETRY_KEEPALIVE_TIMEOUT_MS,
  STALE_SOCKET_ERROR_CODES,
  NON_STALE_SOCKET_ERROR_CODES,
  STALE_SOCKET_ERROR_SUBSTRINGS,
  resolveKeepAliveTimeouts,
  isFreshSocketReplayEnabled,
} from "../config/runtimeConfig.js";
import { dbg } from "./debugLog.js";

const originalFetch = globalThis.fetch;
const proxyDispatchers = new Map();
const directDispatchers = new Map();

export function resetDirectDispatchersForTests() {
  directDispatchers.clear();
  proxyDispatchers.clear();
}

// A dead keep-alive socket (edge dropped it without a RST) surfaces as one of these;
// DNS, refused-connect and TLS failures are excluded so a really unreachable host is
// never mistaken for a stale socket.
export function isStaleSocketError(error) {
  if (!error || error.name === "AbortError") return false;
  const code = error?.cause?.code || error?.code || "";
  if (NON_STALE_SOCKET_ERROR_CODES.has(code)) return false;
  if (STALE_SOCKET_ERROR_CODES.has(code)) return true;
  const msg = `${error?.message || ""} ${error?.cause?.message || ""}`.toLowerCase();
  return STALE_SOCKET_ERROR_SUBSTRINGS.some((sub) => msg.includes(sub));
}

async function getOrCreateDirectAgent(key, keepAliveTimeout, keepAliveMaxTimeout) {
  const cached = directDispatchers.get(key);
  if (cached) return cached;
  const { Agent } = await import("undici");
  if (directDispatchers.size >= MEMORY_CONFIG.proxyDispatchersMaxSize) {
    const oldestKey = directDispatchers.keys().next().value;
    directDispatchers.get(oldestKey)?.close?.().catch?.(() => {});
    directDispatchers.delete(oldestKey);
  }
  const agent = new Agent({ keepAliveTimeout, keepAliveMaxTimeout });
  directDispatchers.set(key, agent);
  return agent;
}

// Shared direct dispatcher with a capped keep-alive TTL, so undici never reuses an idle
// socket that an upstream edge (Cloudflare, AWS Global Accelerator) already dropped.
export function getDirectDispatcher() {
  const { keepAliveTimeout, keepAliveMaxTimeout } = resolveKeepAliveTimeouts();
  return getOrCreateDirectAgent(`direct::${keepAliveTimeout}::${keepAliveMaxTimeout}`, keepAliveTimeout, keepAliveMaxTimeout);
}

// No-keep-alive dispatcher: guarantees a fresh TCP/TLS connection.
export function getFreshRetryDispatcher() {
  return getOrCreateDirectAgent("fresh", FRESH_RETRY_KEEPALIVE_TIMEOUT_MS, FRESH_RETRY_KEEPALIVE_TIMEOUT_MS);
}

// Fail closed: only bodies that can be sent twice are replayable. A stream is consumable
// once, so retrying with it would send a truncated or empty request.
function isBodyReplaySafe(body) {
  return body == null || typeof body === "string" || body instanceof URLSearchParams;
}

// Direct path. When a pooled socket dies before response headers, replay once on a fresh
// socket instead of waiting out the connect timeout. Only errors that prove the socket
// died qualify (never a bare "fetch failed": the upstream may already hold the request
// and a replay would bill it twice). Residual risk: UND_ERR_SOCKET / "other side closed"
// can also fire after the body was written, so a replay may rarely submit a POST twice;
// this matches the executor's own 502 retry. FETCH_FRESH_RETRY=off removes the replay.
async function directFetch(url, options, forceFreshSocket = false) {
  const dispatcher = await (forceFreshSocket ? getFreshRetryDispatcher() : getDirectDispatcher());
  try {
    return await originalFetch(url, { ...options, dispatcher });
  } catch (err) {
    if (
      !forceFreshSocket
      && !options?.signal?.aborted
      && isBodyReplaySafe(options?.body)
      && isFreshSocketReplayEnabled()
      && isStaleSocketError(err)
    ) {
      dbg("FETCH", `stale keep-alive socket (${err.cause?.code || err.code || err.message}), retrying on fresh socket: ${url}`);
      return directFetch(url, options, true);
    }
    throw err;
  }
}

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function shouldBypassByNoProxy(targetUrl, noProxyValue) {
  const noProxy = normalizeString(noProxyValue);
  if (!noProxy) return false;

  let hostname;
  try { hostname = new URL(targetUrl).hostname.toLowerCase(); } catch { return false; }
  const patterns = noProxy.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);

  return patterns.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.startsWith(".")) return hostname.endsWith(pattern) || hostname === pattern.slice(1);
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  });
}

/**
 * Get proxy URL from environment
 */
function getEnvProxyUrl(targetUrl) {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  let protocol;
  try { protocol = new URL(targetUrl).protocol; } catch { return null; }

  if (protocol === "https:") {
    return process.env.HTTPS_PROXY || process.env.https_proxy ||
      process.env.ALL_PROXY || process.env.all_proxy;
  }

  return process.env.HTTP_PROXY || process.env.http_proxy ||
    process.env.ALL_PROXY || process.env.all_proxy;
}

/**
 * Normalize proxy URL (allow host:port)
 */
function normalizeProxyUrl(proxyUrl) {
  const normalizedInput = normalizeString(proxyUrl);
  if (!normalizedInput) return null;

  try {

    new URL(normalizedInput);
    return normalizedInput;
  } catch {
    // Allow "127.0.0.1:7890" style values
    return `http://${normalizedInput}`;
  }
}

function resolveConnectionProxyUrl(targetUrl, proxyOptions) {
  const enabled = proxyOptions?.enabled === true || proxyOptions?.connectionProxyEnabled === true;
  if (!enabled) return null;

  const proxyUrlRaw = normalizeString(proxyOptions?.url ?? proxyOptions?.connectionProxyUrl);
  if (!proxyUrlRaw) return null;

  const noProxy = normalizeString(proxyOptions?.noProxy ?? proxyOptions?.connectionNoProxy);
  if (noProxy && shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  return normalizeProxyUrl(proxyUrlRaw);
}

/**
 * Create proxy dispatcher lazily (undici-compatible)
 */
async function getDispatcher(proxyUrl) {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) return null;

  if (!proxyDispatchers.has(normalized)) {
    // Evict oldest entry if max size reached
    if (proxyDispatchers.size >= MEMORY_CONFIG.proxyDispatchersMaxSize) {
      proxyDispatchers.delete(proxyDispatchers.keys().next().value);
    }
    const { ProxyAgent } = await import("undici");
    proxyDispatchers.set(normalized, new ProxyAgent({ uri: normalized }));
  }

  return proxyDispatchers.get(normalized);
}

export async function proxyAwareFetch(url, options = {}, proxyOptions = null) {
  const targetUrl = typeof url === "string" ? url : url.toString();

  // Vercel relay: forward request via relay headers
  const vercelRelayUrl = normalizeString(proxyOptions?.vercelRelayUrl);
  if (vercelRelayUrl) {
    const parsed = new URL(targetUrl);
    const baseHeaders = options.headers instanceof Headers
      ? Object.fromEntries(options.headers.entries())
      : { ...(options.headers || {}) };
    const relayHeaders = {
      ...baseHeaders,
      "x-relay-target": `${parsed.protocol}//${parsed.host}`,
      "x-relay-path": `${parsed.pathname}${parsed.search}`,
    };
    return originalFetch(vercelRelayUrl, { ...options, headers: relayHeaders });
  }

  const connectionProxyUrl = resolveConnectionProxyUrl(targetUrl, proxyOptions);
  const envProxyUrl = connectionProxyUrl ? null : normalizeProxyUrl(getEnvProxyUrl(targetUrl));
  const proxyUrl = connectionProxyUrl || envProxyUrl;

  if (proxyUrl) {
    try {
      const dispatcher = await getDispatcher(proxyUrl);
      return await originalFetch(url, { ...options, dispatcher });
    } catch (proxyError) {
      // If strictProxy is enabled, fail hard instead of falling back to direct
      if (proxyOptions?.strictProxy === true) {
        throw new Error(`[ProxyFetch] Proxy required but failed (strictProxy=true): ${proxyError.message}`);
      }
      console.warn(`[ProxyFetch] Proxy failed, falling back to direct: ${proxyError.message}`);
      return directFetch(url, options, proxyOptions?.forceFreshSocket === true);
    }
  }

  // Strict mode means "never leave over the direct IP". Reaching here with a
  // proxy configured but unresolved is exactly that case — an inactive or
  // empty pool, or every proxy removed — so refuse instead of silently
  // exposing the real address (#4333). The catch blocks above only cover a
  // proxy that was actually tried.
  //
  // Gate on a proxy being *intended*: callers like the Qoder executor set
  // strictProxy to mean "do not replay this request directly if the proxy
  // fails" (a replayed COSY signature returns 403), not "a proxy is required".
  // With nothing configured they must keep working.
  const proxyIntended = proxyOptions?.proxyPoolId
    || proxyOptions?.enabled === true
    || proxyOptions?.connectionProxyEnabled === true
    || !!normalizeString(proxyOptions?.url ?? proxyOptions?.connectionProxyUrl);
  if (proxyOptions?.strictProxy === true && proxyIntended) {
    throw new Error("[ProxyFetch] Proxy required but none resolved (strictProxy=true)");
  }

  const forceFreshSocket = proxyOptions?.forceFreshSocket === true;
  return directFetch(url, options, forceFreshSocket);
}

/**
 * Patched global fetch with env-proxy support
 */
async function patchedFetch(url, options = {}) {
  return proxyAwareFetch(url, options, null);
}

// Idempotency guard — only patch once to avoid wrapping multiple times
if (globalThis.fetch !== patchedFetch) {
  globalThis.fetch = patchedFetch;
}

export default patchedFetch;
