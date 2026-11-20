export const OPENCODE_MODELS_URL = "https://opencode.ai/zen/v1/models";
export const KNOWN_FREE_OPENCODE_MODELS = ["big-pickle"];
export const DEAD_FREE_OPENCODE_MODELS = new Set(["deepseek-v4-flash-free"]);

const FETCH_TIMEOUT_MS = 5000;
const SUCCESS_TTL_MS = 10 * 60 * 1000;
const FAILURE_BACKOFF_MS = 60 * 1000;

let cache = { value: null, expiresAt: 0 };
let inFlight = null;

export function isOpencodeFreeModelId(id) {
  return typeof id === "string" && (id.endsWith("-free") || KNOWN_FREE_OPENCODE_MODELS.includes(id)) && !DEAD_FREE_OPENCODE_MODELS.has(id);
}

export function parseOpencodeFreeModels(data) {
  const raw = Array.isArray(data?.models) ? data.models : Array.isArray(data?.data) ? data.data : [];
  return raw
    .map((m) => ({ m, id: m?.id || m?.name }))
    .filter(({ id }) => isOpencodeFreeModelId(id))
    .map(({ m, id }) => {
      const caps = {};
      if (m.limit?.context > 0) caps.contextWindow = m.limit.context;
      if (m.limit?.output > 0) caps.maxOutput = m.limit.output;
      if (m.capabilities?.reasoning?.supported) caps.reasoning = true;
      if (m.capabilities?.tools?.supported) caps.tools = true;
      return { id, name: m.name || id, capabilities: Object.keys(caps).length ? caps : undefined };
    });
}

async function fetchOpencodeFreeModels() {
  try {
    const res = await fetch(OPENCODE_MODELS_URL, {
      headers: { "x-opencode-client": "desktop" },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const models = parseOpencodeFreeModels(await res.json());
    return models.length ? { models } : null;
  } catch {
    return null;
  }
}

export async function resolveOpencodeFreeModels() {
  if (Date.now() < cache.expiresAt) return cache.value;
  if (!inFlight) {
    inFlight = fetchOpencodeFreeModels()
      .then((value) => {
        cache = { value, expiresAt: Date.now() + (value ? SUCCESS_TTL_MS : FAILURE_BACKOFF_MS) };
        return value;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function clearOpencodeFreeModelsCache() {
  cache = { value: null, expiresAt: 0 };
  inFlight = null;
}
