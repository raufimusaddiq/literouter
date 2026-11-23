
import commandcodeProvider from "../providers/registry/commandcode.js";
import { setRuntimePricing } from "../providers/pricing.js";

export const COMMANDCODE_MODELS_URL = "https://api.commandcode.ai/provider/v1/models?view=client";

const FETCH_TIMEOUT_MS = 5000;
const TTL_MS = 15 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const FORCE_REFRESH_MIN_MS = 60 * 1000;
const CMC_RATE_MAX = 1000;

const CATALOG_HEADERS = {
  Accept: "application/json",
  "x-cli-surface": "cli",
};

let cache = null;
let nextFetchAt = 0;
let inflight = null;
let failureUntil = 0;
let lastForcedAt = 0;

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

export function parseCommandCodePricing(data) {
  const models = Array.isArray(data?.data) ? data.data : [];
  const out = Object.create(null);
  const sane = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= CMC_RATE_MAX;
  for (const model of models) {
    if (!model?.id || model.hidden) continue;
    const p = model.pricing;
    if (!p || !sane(p.inputCost) || !sane(p.outputCost)) continue;
    out[model.id] = {
      input: p.inputCost,
      output: p.outputCost,
      ...(sane(p.cacheReadCost) ? { cached: p.cacheReadCost } : {}),
      ...(sane(p.cacheWriteCost) ? { cache_creation: p.cacheWriteCost } : {}),
      reasoning: p.outputCost,
    };
  }
  return out;
}

async function fetchCatalog() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(COMMANDCODE_MODELS_URL, {
      method: "GET",
      signal: ctrl.signal,
      headers: { ...commandcodeProvider.transport.headers, ...CATALOG_HEADERS },
    });
    if (!response?.ok) throw new Error(`catalog ${response?.status}`);
    const payload = await response.json();
    const models = parseCommandCodeModels(payload);
    if (!models.length) throw new Error("empty catalog");
    setRuntimePricing("commandcode", parseCommandCodePricing(payload));
    cache = { models };
    nextFetchAt = Date.now() + TTL_MS;
    failureUntil = 0;
    return cache;
  } catch {
    nextFetchAt = Date.now() + RETRY_MS;
    failureUntil = Date.now() + RETRY_MS;
    return null;
  } finally {
    clearTimeout(timer);
    inflight = null;
  }
}

export async function resolveCommandCodeModels({ forceRefresh = false } = {}) {
  const now = Date.now();

  if (now < failureUntil) return cache ?? null;

  if (forceRefresh) {
    if (now - lastForcedAt < FORCE_REFRESH_MIN_MS) return cache ?? null;
    lastForcedAt = now;
  } else if (now < nextFetchAt) {
    return cache ?? null;
  }

  if (!inflight) inflight = fetchCatalog();
  return (await inflight) ?? cache ?? null;
}

export function resetCommandCodeCache() {
  cache = null;
  nextFetchAt = 0;
  inflight = null;
  failureUntil = 0;
  lastForcedAt = 0;
}
