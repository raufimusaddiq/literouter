import REGISTRY from "../providers/registry/index.js";

const ALIAS_TO_PROVIDER_ID = {};
for (const entry of REGISTRY) {
  ALIAS_TO_PROVIDER_ID[entry.id] = entry.id;
  if (entry.alias) ALIAS_TO_PROVIDER_ID[entry.alias] = entry.id;
  for (const a of entry.aliases || []) ALIAS_TO_PROVIDER_ID[a] = entry.id;
}

const BUILTIN_MODEL_ALIASES = {
  "grok-build": "gcli/grok-build",
};

export function resolveProviderAlias(aliasOrId) {
  return ALIAS_TO_PROVIDER_ID[aliasOrId] || aliasOrId;
}

export function parseModel(modelStr) {
  if (!modelStr) {
    return { provider: null, model: null, isAlias: false, providerAlias: null };
  }

  if (modelStr.includes("/")) {
    const firstSlash = modelStr.indexOf("/");
    const providerOrAlias = modelStr.slice(0, firstSlash);
    const model = modelStr.slice(firstSlash + 1);
    const provider = resolveProviderAlias(providerOrAlias);
    return { provider, model, isAlias: false, providerAlias: providerOrAlias };
  }

  return {
    provider: null,
    model: modelStr,
    isAlias: true,
    providerAlias: null,
  };
}

export function resolveModelAliasFromMap(alias, aliases) {
  if (!aliases) return null;

  const resolved = aliases[alias];
  if (!resolved) return null;

  if (typeof resolved === "string" && resolved.includes("/")) {
    const firstSlash = resolved.indexOf("/");
    const providerOrAlias = resolved.slice(0, firstSlash);
    return {
      provider: resolveProviderAlias(providerOrAlias),
      model: resolved.slice(firstSlash + 1),
    };
  }

  if (typeof resolved === "object" && resolved.provider && resolved.model) {
    return {
      provider: resolveProviderAlias(resolved.provider),
      model: resolved.model,
    };
  }

  return null;
}

export async function getModelInfoCore(modelStr, aliasesOrGetter) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    return {
      provider: parsed.provider,
      model: parsed.model,
    };
  }

  const aliases =
    typeof aliasesOrGetter === "function"
      ? await aliasesOrGetter()
      : aliasesOrGetter;

  const resolved =
    resolveModelAliasFromMap(parsed.model, aliases) ||
    resolveModelAliasFromMap(parsed.model, BUILTIN_MODEL_ALIASES);
  if (resolved) {
    return resolved;
  }

  return {
    provider: inferProviderFromModelName(parsed.model),
    model: parsed.model,
  };
}

const MODEL_PREFIX_PROVIDERS = [
  [/^codex-auto-review$/, "codex"],
  [/^claude-/, "anthropic"],
  [/^gemini-/, "gemini"],
  [/^gpt-/, "openai"],
  [/^o[134]/, "openai"],
  [/^deepseek-/, "openrouter"],
];

function inferProviderFromModelName(modelName) {
  if (!modelName) return "openai";
  const m = modelName.toLowerCase();
  return MODEL_PREFIX_PROVIDERS.find(([re]) => re.test(m))?.[1] || "openai";
}
