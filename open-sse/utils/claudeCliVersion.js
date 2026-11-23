
const NPM_URL = "https://registry.npmjs.org/@anthropic-ai/claude-code/latest";
const TTL_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 3000;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

let fallback = "2.1.295";
let current = null;
let nextCheckAt = 0;
let inflight = null;

function cmp(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

const envPin = typeof process !== "undefined" && VERSION_RE.test(process.env?.CLAUDE_CLI_VERSION || "")
  ? process.env.CLAUDE_CLI_VERSION
  : null;

export function setClaudeCliFallback(version) {
  if (VERSION_RE.test(version) && cmp(version, fallback) > 0) fallback = version;
}

export function getClaudeCliVersion() {
  const floor = fallback;
  if (envPin) return cmp(envPin, floor) > 0 ? envPin : floor;
  return current && cmp(current, floor) > 0 ? current : floor;
}

let defaultFetchPromise = null;
function defaultFetch(url, options) {
  if (!defaultFetchPromise) {
    defaultFetchPromise = import("./proxyFetch.js")
      .then((mod) => mod.proxyAwareFetch)
      .catch(() => null);
  }
  return defaultFetchPromise.then((impl) =>
    impl ? impl(url, options) : (globalThis.fetch?.(url, options) ?? Promise.reject(new Error("no fetch")))
  );
}

async function lookup(fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const doFetch = fetchImpl || defaultFetch;
    const res = await doFetch(NPM_URL, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res?.ok) throw new Error(`npm ${res?.status}`);
    const version = (await res.json())?.version;
    if (!VERSION_RE.test(version || "")) throw new Error("bad version");
    current = version;
    nextCheckAt = Date.now() + TTL_MS;
  } catch {
    nextCheckAt = Date.now() + RETRY_MS;
  } finally {
    clearTimeout(timer);
    inflight = null;
  }
}

export function ensureClaudeCliVersion(fetchImpl) {
  if (envPin || Date.now() < nextCheckAt) return getClaudeCliVersion();
  if (!inflight) inflight = lookup(fetchImpl);
  return getClaudeCliVersion();
}

export function resetClaudeCliVersion() {
  current = null;
  nextCheckAt = 0;
  inflight = null;
}

const UA_RE = /claude-cli\/\d+\.\d+\.\d+/g;

export function applyClaudeCliVersion(headers) {
  if (!headers) return headers;
  const v = getClaudeCliVersion();
  if (!VERSION_RE.test(v)) return headers;
  const fix = (val) => (typeof val === "string" ? val.replace(UA_RE, `claude-cli/${v}`) : val);
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    const out = new Headers(headers);
    for (const [k, val] of headers.entries()) out.set(k, fix(val));
    return out;
  }
  if (Array.isArray(headers)) return headers.map(([k, val]) => [k, fix(val)]);
  const out = {};
  for (const [k, val] of Object.entries(headers)) out[k] = fix(val);
  return out;
}
