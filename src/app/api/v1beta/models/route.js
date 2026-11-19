import { PROVIDER_MODELS } from "@/shared/constants/models";
import { getKeyAccessContext, filterModelsListForKey } from "@/sse/services/keyAccess.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { buildErrorBody } from "open-sse/utils/error.js";
import { FORMATS } from "open-sse/translator/formats.js";

// Fallbacks when the registry has no limits for a model.
const DEFAULT_INPUT_TOKEN_LIMIT = 128000;
const DEFAULT_OUTPUT_TOKEN_LIMIT = 8192;

function limitsFor(provider, modelId) {
  const caps = getCapabilitiesForModel(provider, modelId) || {};
  return {
    inputTokenLimit: Number.isFinite(caps.contextWindow) && caps.contextWindow > 0 ? caps.contextWindow : DEFAULT_INPUT_TOKEN_LIMIT,
    outputTokenLimit: Number.isFinite(caps.maxOutput) && caps.maxOutput > 0 ? caps.maxOutput : DEFAULT_OUTPUT_TOKEN_LIMIT,
  };
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * GET /v1beta/models - Gemini compatible models list
 * Returns models in Gemini API format
 */
export async function GET(request) {
  try {
    const models = [];
    const seen = new Set();

    function addModel({ name, displayName, description, methods = ["generateContent"], limits }) {
      if (seen.has(name)) return;
      seen.add(name);
      models.push({
        name,
        displayName,
        description,
        supportedGenerationMethods: methods,
        ...limits,
      });
    }
    
    for (const [provider, providerModels] of Object.entries(PROVIDER_MODELS)) {
      for (const model of providerModels) {
        addModel({
          name: `models/${provider}/${model.id}`,
          displayName: model.name || model.id,
          description: `${provider} model: ${model.name || model.id}`,
          limits: limitsFor(provider, model.id),
        });

        if (provider === "gemini") {
          addModel({
            name: `models/${model.id}`,
            displayName: model.name || model.id,
            description: `Gemini model: ${model.name || model.id}`,
            methods: ["generateContent", "streamGenerateContent"],
            limits: limitsFor(provider, model.id),
          });
        }
      }
    }

    // Restricted keys only see what they may call. The filter keys on `id` (provider/model),
    // so run it over ids derived from the Gemini `name` and map back.
    const ctx = await getKeyAccessContext(request);
    if (!ctx) return Response.json({ models });
    const byId = new Map(models.map((m) => [m.name.replace(/^models\//, ""), m]));
    const allowed = await filterModelsListForKey(ctx, [...byId.keys()].map((id) => ({ id, owned_by: "model", kind: "llm" })));
    return Response.json({ models: allowed.map((e) => byId.get(e.id)) });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json(buildErrorBody(500, error.message, FORMATS.GEMINI), { status: 500 });
  }
}
