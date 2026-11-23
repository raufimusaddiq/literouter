import { getModelAliases, getComboByName, getProviderNodes, getProviderConnections } from "@/lib/db/index.js";
import { parseModel as parseModelCore, getModelInfoCore } from "open-sse/services/model.js";
import REGISTRY from "open-sse/providers/registry/index.js";

const LOCAL_PROVIDER_ALIASES = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
};

const RESERVED_PROVIDER_PREFIXES = new Set(Object.keys(LOCAL_PROVIDER_ALIASES));
for (const entry of REGISTRY) {
  RESERVED_PROVIDER_PREFIXES.add(entry.id);
  if (entry.alias) RESERVED_PROVIDER_PREFIXES.add(entry.alias);
  for (const alias of entry.aliases || []) RESERVED_PROVIDER_PREFIXES.add(alias);
}

export function parseModel(modelStr) {
  const parsed = parseModelCore(modelStr);
  if (parsed?.providerAlias && LOCAL_PROVIDER_ALIASES[parsed.providerAlias]) {
    return { ...parsed, provider: LOCAL_PROVIDER_ALIASES[parsed.providerAlias] };
  }
  return parsed;
}

export async function getModelInfo(modelStr) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    if (!RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias)) {
      const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
      const matchedOpenAI = openaiNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedOpenAI) {
        return { provider: matchedOpenAI.id, model: parsed.model };
      }

      const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
      const matchedAnthropic = anthropicNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedAnthropic) {
        return { provider: matchedAnthropic.id, model: parsed.model };
      }

    }
    return {
      provider: parsed.provider,
      model: parsed.model
    };
  }

  const combo = await getComboByName(parsed.model, { clone: false });
  if (combo) {
    return { provider: null, model: parsed.model };
  }

  return fallbackToClaudeOAuth(await getModelInfoCore(modelStr, () => getModelAliases({ clone: false })));
}

export async function getComboModels(modelStr) {
  if (modelStr.includes("/")) return null;

  const combo = await getComboByName(modelStr, { clone: false });
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}

async function fallbackToClaudeOAuth(info) {
  if (info?.provider !== "anthropic") return info;
  const hasActive = async (provider) =>
    (await getProviderConnections({ provider, isActive: true }, { clone: false })).length > 0;
  if (await hasActive("anthropic")) return info;
  if (!(await hasActive("claude"))) return info;
  return { ...info, provider: "claude" };
}
