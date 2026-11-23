import {
  STALE_SOCKET_ERROR_CODES,
  NON_STALE_SOCKET_ERROR_CODES,
  STALE_SOCKET_ERROR_SUBSTRINGS,
  isFreshSocketReplayEnabled,
  UNDICI_BACKSTOP_MS,
} from "../config/runtimeConfig.js";
import { dbg } from "./debugLog.js";
import { ensureClaudeCliVersion, applyClaudeCliVersion } from "./claudeCliVersion.js";

const CLAUDE_UA_PROBE = /claude-cli\/\d/;
function hasClaudeCliHeader(headers) {
  if (!headers) return false;
  const values = headers instanceof Headers ? [...headers.values()] : Array.isArray(headers) ? headers.map((h) => h[1]) : Object.values(headers);
  return values.some((v) => typeof v === "string" && CLAUDE_UA_PROBE.test(v));
}

const originalFetch = globalThis.fetch;

export function isStaleSocketError(error) {
  if (!error || error.name === "AbortError") return false;
  const code = error?.cause?.code || error?.code || "";
  if (NON_STALE_SOCKET_ERROR_CODES.has(code)) return false;
  if (STALE_SOCKET_ERROR_CODES.has(code)) return true;
  const msg = `${error?.message || ""} ${error?.cause?.message || ""}`.toLowerCase();
  return STALE_SOCKET_ERROR_SUBSTRINGS.some((sub) => msg.includes(sub));
}

function isBodyReplaySafe(body) {
  return body == null || typeof body === "string" || body instanceof URLSearchParams;
}

function backstopTimeoutError() {
  return new DOMException(`Upstream produced no data for ${UNDICI_BACKSTOP_MS}ms`, "TimeoutError");
}

function wrapBodyWithIdleBackstop(response, rearm, clear) {
  if (!(response instanceof Response) || !response.body) {
    clear();
    return response;
  }
  const body = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) { rearm(); controller.enqueue(chunk); },
    flush() { clear(); },
  }));
  const wrapped = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  try { Object.defineProperty(wrapped, "url", { value: response.url }); } catch {}
  return wrapped;
}

async function fetchWithBackstop(url, options) {
  const controller = new AbortController();
  let timer = null;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const rearm = () => { clear(); timer = setTimeout(() => controller.abort(backstopTimeoutError()), UNDICI_BACKSTOP_MS); };
  const signal = options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  rearm();
  try {
    const response = await originalFetch(url, { ...options, signal });
    return wrapBodyWithIdleBackstop(response, rearm, clear);
  } catch (err) {
    clear();
    throw err;
  }
}

async function directFetch(url, options, forceFreshSocket = false) {
  try {
    return await fetchWithBackstop(url, forceFreshSocket ? { ...options, keepalive: false } : options);
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

function normalizeProxyUrl(proxyUrl) {
  const normalizedInput = normalizeString(proxyUrl);
  if (!normalizedInput) return null;

  try {

    new URL(normalizedInput);
    return normalizedInput;
  } catch {
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

export async function proxyAwareFetch(url, options = {}, proxyOptions = null) {
  if (options?.proxy) return originalFetch(url, options);

  if (hasClaudeCliHeader(options?.headers)) {
    ensureClaudeCliVersion();
    options = { ...options, headers: applyClaudeCliVersion(options.headers) };
  }
  const targetUrl = typeof url === "string" ? url : url.toString();

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
      return await fetchWithBackstop(url, { ...options, proxy: proxyUrl });
    } catch (proxyError) {
      if (proxyOptions?.strictProxy === true) {
        throw new Error(`[ProxyFetch] Proxy required but failed (strictProxy=true): ${proxyError.message}`);
      }
      console.warn(`[ProxyFetch] Proxy failed, falling back to direct: ${proxyError.message}`);
      return directFetch(url, options, proxyOptions?.forceFreshSocket === true);
    }
  }

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

async function patchedFetch(url, options = {}) {
  return proxyAwareFetch(url, options, null);
}

if (globalThis.fetch !== patchedFetch) {
  globalThis.fetch = patchedFetch;
}

export default patchedFetch;
