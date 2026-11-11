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
 *   - the fetch goes through proxyAwareFetch (proxy/keep-alive aware) and sends
 *     the CLI identity headers only — never a connection key.
 */

import commandcodeProvider from "../providers/registry/commandcode.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

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

async function fetchCatalog() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await proxyAwareFetch(COMMANDCODE_MODELS_URL, {
      method: "GET",
      signal: ctrl.signal,
      headers: { ...commandcodeProvider.transport.headers, ...CATALOG_HEADERS },
    });
    if (!response?.ok) throw new Error(`catalog ${response?.status}`);
    const models = parseCommandCodeModels(await response.json());
    if (!models.length) throw new Error("empty catalog");
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
