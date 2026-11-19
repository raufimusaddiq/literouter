/**
 * CommandCode model discovery.
 *
 * CommandCode publishes the same catalog its own CLI polls — a public endpoint
 * (no auth, ETag = catalogVersion, refreshAfterSeconds: 900). The registry's
 * static `models` array is only an offline fallback: it lags every vendor
 * release, so both the dashboard provider page and GET /v1/models resolve the
 * catalog live.
 *
 * Hardening (LiteRouter):
 *   - bounded: 5s abort, 15min success cache, 60s failure backoff,
 *   - at most one fetch in flight; concurrent callers share it,
 *   - never throws: any error yields null so callers fall back to static rows,
 *   - the fetch goes through the patched global fetch (proxy/keep-alive aware)
 *     and sends the CLI identity headers only — never a connection key.
 */

import commandcodeProvider from "../providers/registry/commandcode.js";
import { setRuntimePricing } from "../providers/pricing.js";

export const COMMANDCODE_MODELS_URL = "https://api.commandcode.ai/provider/v1/models?view=client";

const FETCH_TIMEOUT_MS = 5000;
const TTL_MS = 15 * 60 * 1000;
const RETRY_MS = 60 * 1000;

// Catalog identity: the endpoint is the one the vendor CLI polls, so it answers
// the CLI's own headers. Merged over the registry transport headers (version,
// environment) and completed with the surface flag the vendor checks.
const CATALOG_HEADERS = {
  Accept: "application/json",
  "x-cli-surface": "cli",
};

let cache = null;
let nextFetchAt = 0;
let inflight = null;

/**
 * Catalog rows carry display copy plus capability flags. `hidden` entries are
 * the free/stealth aliases the vendor CLI keeps out of its own picker.
 */
export function parseCommandCodeModels(data) {
  const models = Array.isArray(data?.data) ? data.data : [];
  return models
    .filter((model) => model?.id && !model.hidden)
    .map((model) => {
      const modalities = Array.isArray(model.inputModalities) ? model.inputModalities : [];
      const efforts = Array.isArray(model.reasoningEfforts) ? model.reasoningEfforts : [];
      return {
        id: model.id,
        name: model.display?.label || model.name || model.id,
        description: model.display?.description || null,
        contextLength: model.context_length,
        maxOutputTokens: model.maxOutputTokens ?? undefined,
        isVL: modalities.includes("image"),
        isReasoning: efforts.length > 0,
      };
    });
}

// The catalog publishes per-model rates (inputCost/outputCost/cacheReadCost/
// cacheWriteCost in $/1M tokens). Map them to the pricing shape so a newly
// released id bills correctly without waiting for a LiteRouter release.
export function parseCommandCodePricing(data) {
  const models = Array.isArray(data?.data) ? data.data : [];
  const out = {};
  for (const model of models) {
    if (!model?.id || model.hidden) continue;
    const p = model.pricing;
    if (!p || typeof p.inputCost !== "number" || typeof p.outputCost !== "number") continue;
    out[model.id] = {
      input: p.inputCost,
      output: p.outputCost,
      ...(typeof p.cacheReadCost === "number" ? { cached: p.cacheReadCost } : {}),
      ...(typeof p.cacheWriteCost === "number" ? { cache_creation: p.cacheWriteCost } : {}),
      reasoning: p.outputCost,
    };
  }
  return out;
}

async function fetchCatalog() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    // Use the patched global fetch so the same proxy/keep-alive policy the chat
    // path uses also covers the catalog probe; no credentials are sent.
    const response = await fetch(COMMANDCODE_MODELS_URL, {
      method: "GET",
      signal: ctrl.signal,
      headers: { ...commandcodeProvider.transport.headers, ...CATALOG_HEADERS },
    });
    if (!response?.ok) throw new Error(`catalog ${response?.status}`);
    const payload = await response.json();
    const models = parseCommandCodeModels(payload);
    if (!models.length) throw new Error("empty catalog");
    // The vendor publishes its own rates; register them so a model released after
    // this build still bills at the real price instead of $0.
    setRuntimePricing("commandcode", parseCommandCodePricing(payload));
    cache = { models };
    nextFetchAt = Date.now() + TTL_MS;
    return cache;
  } catch {
    // Fail open to the static registry list; retry after a short backoff.
    nextFetchAt = Date.now() + RETRY_MS;
    return null;
  } finally {
    clearTimeout(timer);
    inflight = null;
  }
}

/**
 * Fetch the live catalog. Returns null when the vendor endpoint is unreachable
 * or answers non-2xx so callers can fall back to their static list.
 * `forceRefresh` bypasses the success cache (dashboard refresh button).
 */
export async function resolveCommandCodeModels({ forceRefresh = false } = {}) {
  if (!forceRefresh && cache && Date.now() < nextFetchAt) return cache;
  if (!forceRefresh && Date.now() < nextFetchAt) return null;
  if (!inflight) inflight = fetchCatalog();
  return inflight;
}

// Test seam: drop the cached catalog and any backoff window.
export function resetCommandCodeCache() {
  cache = null;
  nextFetchAt = 0;
  inflight = null;
}
