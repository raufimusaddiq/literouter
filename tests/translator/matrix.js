import {
  PROVIDER_MODELS,
  PROVIDER_ID_TO_ALIAS,
  getModelTargetFormat,
  getModelStrip,
  getModelUpstreamId,
} from "../../open-sse/config/providerModels.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const ALIAS_TO_PROVIDER_ID = Object.fromEntries(
  Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id])
);

function providerFormat(alias) {
  const providerId = ALIAS_TO_PROVIDER_ID[alias] || alias;
  return PROVIDERS[providerId]?.format || FORMATS.OPENAI;
}

export function resolveTargetFormat(alias, modelId) {
  return getModelTargetFormat(alias, modelId) || providerFormat(alias);
}

export function buildModelMatrix() {
  const rows = [];
  for (const [alias, models] of Object.entries(PROVIDER_MODELS)) {
    if (!Array.isArray(models)) continue;
    for (const m of models) {
      rows.push({
        alias,
        providerId: ALIAS_TO_PROVIDER_ID[alias] || alias,
        modelId: m.id,
        type: m.type || "llm",
        targetFormat: resolveTargetFormat(alias, m.id),
        strip: getModelStrip(alias, m.id),
        upstreamId: getModelUpstreamId(alias, m.id),
      });
    }
  }
  return rows;
}

export function buildProviderGroups() {
  const groups = [];
  for (const [alias, models] of Object.entries(PROVIDER_MODELS)) {
    if (!Array.isArray(models) || models.length === 0) continue;
    const llm = models.filter((m) => (m.type || "llm") === "llm");
    groups.push({ alias, models: llm.length ? llm : models });
  }
  return groups;
}

export const CLI_SOURCE_FORMATS = [
  FORMATS.CLAUDE,
  FORMATS.OPENAI_RESPONSES,
  FORMATS.GEMINI,
  FORMATS.OPENAI,
  FORMATS.ANTIGRAVITY,
];
