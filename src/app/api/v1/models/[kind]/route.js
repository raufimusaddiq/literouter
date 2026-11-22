import { buildModelsList } from "../route.js";
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

const KIND_SLUG_MAP = {
  image: "image",
  tts: "tts",
  stt: "stt",
  embedding: "embedding",
  "image-to-text": "imageToText",
  web: ["webSearch", "webFetch"],
};

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
 * GET /v1/models/{kind} - OpenAI-compatible models list filtered by capability.
 */
export async function GET(request, { params }) {
  try {
    const { kind } = await params;
    const modelKind = KIND_SLUG_MAP[kind];
    const kindFilter = Array.isArray(modelKind) ? modelKind : [modelKind];

    if (!modelKind) {
      return json(
        {
          error: {
            message: `Unknown model kind: ${kind}. Supported: ${Object.keys(KIND_SLUG_MAP).join(", ")}.`,
            type: "invalid_request_error",
          },
        },
        { status: 404 },
      );
    }

    const data = await filterModelsListForKey(
      await getKeyAccessContext(request),
      await buildModelsList(kindFilter),
    );
    return json({ object: "list", data });
  } catch (error) {
    console.log("Error fetching models by kind:", error);
    return json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 },
    );
  }
}
