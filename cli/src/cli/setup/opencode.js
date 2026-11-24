const path = require("path");
const { PROVIDER_KEY, modelInfo, pickMany, parseJsonConfig, isPlainObject } = require("./shared");

const SCHEMA_URL = "https://opencode.ai/config.json";

function configPath({ env, home, fs }) {
  if (env.OPENCODE_CONFIG) return env.OPENCODE_CONFIG;
  const dir = path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "opencode");
  const json = path.join(dir, "opencode.json");
  const jsonc = path.join(dir, "opencode.jsonc");
  return !fs.existsSync(json) && fs.existsSync(jsonc) ? jsonc : json;
}

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function buildModelEntry(model, prev) {
  const info = modelInfo(model);
  const entry = { ...(isPlainObject(prev) ? prev : {}) };
  entry.name = typeof entry.name === "string" && entry.name ? entry.name : model.id;
  const context = positive(info.contextWindow);
  const output = positive(info.maxOutput);
  if (context && output) entry.limit = { context, output };
  if (!isPlainObject(entry.modalities)) entry.modalities = { input: info.vision ? ["text", "image"] : ["text"], output: ["text"] };
  if (!isPlainObject(entry.variants) && info.thinkingLevels?.length) {
    entry.variants = Object.fromEntries(info.thinkingLevels.map((level) => [level, { reasoningEffort: level }]));
  }
  return entry;
}

function build({ text, filePath, baseUrl, apiKey, selection, opts }) {
  const config = parseJsonConfig(text, filePath, { allowTrailingCommas: true });
  const providers = isPlainObject(config.provider) ? config.provider : {};
  const existing = isPlainObject(providers[PROVIDER_KEY]) ? providers[PROVIDER_KEY] : {};
  const prevModels = isPlainObject(existing.models) ? existing.models : {};
  const models = Object.fromEntries(selection.map((model) => [model.id, buildModelEntry(model, prevModels[model.id])]));
  const next = text === null ? { $schema: SCHEMA_URL, ...config } : { ...config };
  next.provider = {
    ...providers,
    [PROVIDER_KEY]: {
      ...existing,
      npm: existing.npm || "@ai-sdk/openai-compatible",
      name: existing.name || "LiteRouter",
      options: { ...(isPlainObject(existing.options) ? existing.options : {}), baseURL: baseUrl, apiKey },
      models,
    },
  };
  const changes = [`provider "${PROVIDER_KEY}" -> ${baseUrl}`, `${selection.length} model(s): ${selection.map((m) => m.id).join(", ")}`];
  const current = typeof config.model === "string" ? config.model : "";
  const ours = current.startsWith(`${PROVIDER_KEY}/`);
  if (opts.makeDefault || !current || (ours && !models[current.slice(PROVIDER_KEY.length + 1)])) {
    next.model = `${PROVIDER_KEY}/${selection[0].id}`;
    changes.push(`model -> ${next.model}`);
  }
  return { content: `${JSON.stringify(next, null, 2)}\n`, changes };
}

module.exports = {
  id: "opencode",
  summary: "OpenCode: adds a literouter provider to OpenCode's opencode.json",
  pathHint: "~/.config/opencode/opencode.json (or $XDG_CONFIG_HOME/opencode, $OPENCODE_CONFIG)",
  options: `  --models <id,id>   Models to add (ids from /v1/models; the first is the default model)
  --all              Add every chat model the key can use
  --default          Make the first model OpenCode's default even if another is set`,
  next: `In OpenCode, run /models and pick a ${PROVIDER_KEY} model.`,
  configPath,
  select: pickMany,
  build,
  buildModelEntry,
};
