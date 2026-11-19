import { PROVIDER_MODELS } from "@/shared/constants/models";
import { getKeyAccessContext, filterModelsListForKey } from "@/sse/services/keyAccess.js";

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

    function addModel({ name, displayName, description, methods = ["generateContent"] }) {
      if (seen.has(name)) return;
      seen.add(name);
      models.push({
        name,
        displayName,
        description,
        supportedGenerationMethods: methods,
        inputTokenLimit: 128000,
        outputTokenLimit: 8192,
      });
    }
    
    for (const [provider, providerModels] of Object.entries(PROVIDER_MODELS)) {
      for (const model of providerModels) {
        addModel({
          name: `models/${provider}/${model.id}`,
          displayName: model.name || model.id,
          description: `${provider} model: ${model.name || model.id}`,
        });

        if (provider === "gemini") {
          addModel({
            name: `models/${model.id}`,
            displayName: model.name || model.id,
            description: `Gemini model: ${model.name || model.id}`,
            methods: ["generateContent", "streamGenerateContent"],
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
    return Response.json({ error: { message: error.message } }, { status: 500 });
  }
}
