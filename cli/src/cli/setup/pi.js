const path = require("path");
const { PROVIDER_KEY, modelInfo, pickMany, parseJsonConfig, isPlainObject } = require("./shared");

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const DEFAULT_CAPS = { contextWindow: 200000, maxTokens: 64000 };
const CAP_LIMITS = { contextWindow: 2000000, maxTokens: 200000 };

function sanitizeCap(value, fallback, max) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= max ? n : fallback;
}

function levelsFromServer(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const levels = [];
  for (const value of raw) {
    if (typeof value !== "string") return null;
    const level = value === "none" ? "off" : value;
    if (!THINKING_LEVELS.includes(level)) return null;
    levels.push(level);
  }
  return THINKING_LEVELS.filter((level) => levels.includes(level));
}

function thinkingLevelMap(levels) {
  return Object.fromEntries(
    THINKING_LEVELS.map((level) => [level, levels.includes(level) ? (level === "off" ? "none" : level) : null]),
  );
}

function buildModelEntry(model) {
  const info = modelInfo(model);
  const entry = {
    id: model.id,
    name: model.id,
    contextWindow: sanitizeCap(info.contextWindow, DEFAULT_CAPS.contextWindow, CAP_LIMITS.contextWindow),
    maxTokens: sanitizeCap(info.maxOutput, DEFAULT_CAPS.maxTokens, CAP_LIMITS.maxTokens),
    input: info.vision ? ["text", "image"] : ["text"],
    reasoning: info.reasoning,
  };
  if (!info.reasoning) {
    entry.thinkingLevelMap = {};
  } else {
    const levels = levelsFromServer(info.thinkingLevels);
    if (levels) entry.thinkingLevelMap = thinkingLevelMap(levels);
  }
  return entry;
}

function mergeModelEntry(prev, entry) {
  const merged = { ...(isPlainObject(prev) ? prev : {}), ...entry };
  if (isPlainObject(prev) && typeof prev.name === "string" && prev.name && prev.name !== prev.id) merged.name = prev.name;
  if (!("thinkingLevelMap" in entry)) {
    if (isPlainObject(prev?.thinkingLevelMap)) merged.thinkingLevelMap = prev.thinkingLevelMap;
    else delete merged.thinkingLevelMap;
  }
  return merged;
}

function configPath({ env, home, fs }) {
  if (env.PI_CODING_AGENT_DIR) return path.join(env.PI_CODING_AGENT_DIR, "models.json");
  const agentPath = path.join(home, ".pi", "agent", "models.json");
  const legacyPath = path.join(home, ".pi", "models.json");
  return !fs.existsSync(agentPath) && fs.existsSync(legacyPath) ? legacyPath : agentPath;
}

function build({ text, filePath, baseUrl, apiKey, selection }) {
  const config = parseJsonConfig(text, filePath);
  const providers = isPlainObject(config.providers) ? config.providers : {};
  const existing = isPlainObject(providers[PROVIDER_KEY]) ? providers[PROVIDER_KEY] : {};
  const prevModels = new Map(
    (Array.isArray(existing.models) ? existing.models : [])
      .map((m) => (typeof m === "string" ? { id: m } : m))
      .filter((m) => m?.id)
      .map((m) => [m.id, m]),
  );
  const models = selection.map((model) => mergeModelEntry(prevModels.get(model.id), buildModelEntry(model)));
  const next = {
    ...config,
    providers: {
      ...providers,
      [PROVIDER_KEY]: {
        ...existing,
        baseUrl,
        apiKey,
        api: existing.api || "openai-completions",
        models,
      },
    },
  };
  const ids = new Set(models.map((m) => m.id));
  const added = models.filter((m) => !prevModels.has(m.id)).length;
  const removed = [...prevModels.keys()].filter((id) => !ids.has(id)).length;
  return {
    content: `${JSON.stringify(next, null, 2)}\n`,
    changes: [
      `provider "${PROVIDER_KEY}" -> ${baseUrl}`,
      `${models.length} model(s): ${added} added, ${models.length - added} refreshed, ${removed} removed`,
    ],
  };
}

module.exports = {
  id: "pi",
  summary: "Pi coding agent: adds a literouter provider to Pi's models.json",
  pathHint: "~/.pi/agent/models.json (or $PI_CODING_AGENT_DIR/models.json)",
  options: `  --models <id,id>   Models to add (ids from /v1/models)
  --all              Add every chat model the key can use`,
  next: "In Pi, run /model and pick a literouter model.",
  configPath,
  select: pickMany,
  build,
  buildModelEntry,
};
