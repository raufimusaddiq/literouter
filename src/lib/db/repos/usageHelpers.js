import { fingerprintKey } from "open-sse/utils/keyFingerprint.js";

const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T/;

export function sanitizeUsageEntry(entry) {
  if (!entry || !entry.apiKey) return entry;
  return { ...entry, apiKey: fingerprintKey(entry.apiKey) || undefined };
}

export function getLocalDateKey(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isLaterTs(candidate, current) {
  if (typeof candidate !== "string" || !ISO_TS_RE.test(candidate)) return false;
  const c = Date.parse(candidate);
  if (Number.isNaN(c)) return false;
  if (typeof current !== "string" || !ISO_TS_RE.test(current)) return true;
  const cur = Date.parse(current);
  return Number.isNaN(cur) || c > cur;
}

export function addToCounter(target, key, values) {
  if (!target[key]) target[key] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
  target[key].requests += values.requests || 1;
  target[key].promptTokens += values.promptTokens || 0;
  target[key].completionTokens += values.completionTokens || 0;
  target[key].cachedTokens += values.cachedTokens || 0;
  target[key].cost += values.cost || 0;
  if (values.meta) Object.assign(target[key], values.meta);
  if (values.ts && isLaterTs(values.ts, target[key].lastTs)) target[key].lastTs = values.ts;
}

export function dayKeyToFallbackTs(dateKey) {
  const [y, m, d] = String(dateKey).split("-").map(Number);
  const t = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(Math.min(t, Date.now())).toISOString();
}

export function noteDayFallback(store, dim, key, dateKey) {
  const bucket = store[dim] || (store[dim] = {});
  if (!bucket[key] || dateKey > bucket[key]) bucket[key] = dateKey;
}

export function aggregateEntryToDay(day, entry) {
  const promptTokens = entry.tokens?.prompt_tokens || entry.tokens?.input_tokens || 0;
  const completionTokens = entry.tokens?.completion_tokens || entry.tokens?.output_tokens || 0;
  const cachedTokens = entry.tokens?.cached_tokens || entry.tokens?.cache_read_input_tokens || 0;
  const cost = entry.cost || 0;
  const vals = { promptTokens, completionTokens, cachedTokens, cost, ts: entry.timestamp };

  day.requests = (day.requests || 0) + 1;
  day.promptTokens = (day.promptTokens || 0) + promptTokens;
  day.completionTokens = (day.completionTokens || 0) + completionTokens;
  day.cachedTokens = (day.cachedTokens || 0) + cachedTokens;
  day.cost = (day.cost || 0) + cost;

  day.byProvider ||= {};
  day.byModel ||= {};
  day.byAccount ||= {};
  day.byApiKey ||= {};
  day.byEndpoint ||= {};

  if (entry.provider) addToCounter(day.byProvider, entry.provider, vals);

  const modelKey = entry.provider ? `${entry.model}|${entry.provider}` : entry.model;
  addToCounter(day.byModel, modelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });

  if (entry.connectionId) {
    addToCounter(day.byAccount, entry.connectionId, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });
  }

  const apiKeyVal = entry.apiKey && typeof entry.apiKey === "string" ? entry.apiKey : "local-no-key";
  const akModelKey = `${apiKeyVal}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byApiKey, akModelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider, apiKey: entry.apiKey || null } });

  const endpoint = entry.endpoint || "Unknown";
  const epKey = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byEndpoint, epKey, { ...vals, meta: { endpoint, rawModel: entry.model, provider: entry.provider } });
}

export function emptyDay() {
  return {
    requests: 0, promptTokens: 0, completionTokens: 0, cost: 0,
    byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
  };
}

export function formatLogDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export async function calculateCost(provider, model, tokens) {
  if (!tokens || !provider || !model) return 0;
  try {
    const { getPricingForModel } = await import("./pricingRepo.js");
    const pricing = await getPricingForModel(provider, model);
    if (!pricing) {
      const { noteUntrackedModel } = await import("open-sse/providers/trackingGaps.js");
      noteUntrackedModel(provider, model, "cost");
      return 0;
    }

    const { calculateCostFromTokens } = await import("open-sse/providers/pricing.js");
    return calculateCostFromTokens(tokens, pricing);
  } catch (e) {
    console.error("Error calculating cost:", e);
    return 0;
  }
}
