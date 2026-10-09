import { buildModelsList, LLM_KIND, MODEL_TYPE_TO_KIND } from "../route.js";
import { getKeyAccessContext, filterModelsListForKey } from "@/sse/services/keyAccess.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

function json(data, options = {}) {
  return Response.json(data, {
    ...options,
    headers: {
      "Access-Control-Allow-Origin": "*",
      ...options.headers,
    },
  });
}

/**
 * GET /v1/models/{provider}/{model} - OpenAI-compatible single model lookup.
 */
export async function GET(request, { params }) {
  try {
    const { model } = await params;
    const path = Array.isArray(model) ? model : [model];
    const identifier = path.filter(Boolean).join("/");
    // Match the same LLM catalog exposed by GET /v1/models. A catch-all
    // parameter is required because provider-prefixed IDs contain a slash.
    const kind = request.nextUrl?.searchParams?.get("kind");
    const kindFilter = kind ? [kind] : ["llm"];
    const models = await filterModelsListForKey(
      await getKeyAccessContext(request),
      await buildModelsList(kindFilter)
    );
    const isKindLookup = path.length === 1 && (path[0] === LLM_KIND || path[0] in MODEL_TYPE_TO_KIND);
    if (isKindLookup) {
      return json({ object: "list", data: models });
    }
    const matchedModel = models.find((candidate) => candidate.id === identifier);

    if (!matchedModel) {
      return json(
        {
          error: {
            message: `The model '${identifier}' does not exist or you do not have access to it.`,
            type: "invalid_request_error",
            code: "model_not_found",
          },
        },
        { status: 404 },
      );
    }

    return json(matchedModel);
  } catch (error) {
    console.log("Error fetching model:", error);
    return json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 },
    );
  }
}
