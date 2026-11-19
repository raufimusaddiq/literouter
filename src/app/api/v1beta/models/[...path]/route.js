import { handleChat } from "@/sse/handlers/chat.js";
import { SSE_HEADERS_CORS, SSE_NO_COMPRESS_HEADERS } from "open-sse/utils/sseConstants.js";
import {
  clearAccountError,
  getProviderCredentials,
  isValidApiKey,
  markAccountUnavailable,
} from "@/sse/services/auth.js";
import { getSettings } from "@/lib/localDb";
import { PROVIDER_MODELS } from "@/shared/constants/models";
import { GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS } from "open-sse/config/runtimeConfig.js";
import { initTranslators, translateResponse, initState } from "open-sse/translator/index.js";
import { geminiToOpenAIRequest } from "open-sse/translator/request/gemini-to-openai.js";
import { openaiCompletionToGemini } from "open-sse/translator/response/openai-to-gemini.js";
import { FORMATS } from "open-sse/translator/formats.js";
import { buildErrorBody } from "open-sse/utils/error.js";
import { getKeyAccessContext, enforceKeyAccessResolved, extractClientApiKey } from "@/sse/services/keyAccess.js";

let initialized = false;
const GEMINI_NATIVE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
// Gemini model id charset (matches sanitizeGeminiFunctionName); blocks path traversal in upstream URL.
const GEMINI_NATIVE_MODEL_PATTERN = /^[a-zA-Z0-9_.:-]+$/;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1beta/models/{model}:generateContent        — non-streaming
 * POST /v1beta/models/{model}:streamGenerateContent  — streaming (SSE)
 *
 * Streaming intent is determined by the URL action suffix (canonical Gemini API
 * convention), NOT by a body field. generationConfig.stream is not a real
 * Gemini API field and Gemini CLI never sets it.
 *
 * The @google/genai SDK always uses :streamGenerateContent?alt=sse for chat.
 * The upstream handleChat returns OpenAI SSE format; we transform it to
 * Gemini SSE format on the fly via transformOpenAISSEToGeminiSSE().
 */
export async function POST(request, { params }) {
  await ensureInitialized();

  try {
    const { path } = await params;
    // path = ["provider", "model:action"] or ["model:action"]

    let model;
    let action; // ":generateContent" | ":streamGenerateContent"

    if (path.length >= 2) {
      // Format: /v1beta/models/provider/model:generateContent
      const provider = path[0];
      const modelAction = path[1];
      action = modelAction.includes(":streamGenerateContent")
        ? ":streamGenerateContent"
        : ":generateContent";
      const modelName = modelAction
        .replace(":streamGenerateContent", "")
        .replace(":generateContent", "");
      model = provider + "/" + modelName;
    } else {
      // Format: /v1beta/models/model:generateContent
      const modelAction = path[0];
      action = modelAction.includes(":streamGenerateContent")
        ? ":streamGenerateContent"
        : ":generateContent";
      model = modelAction
        .replace(":streamGenerateContent", "")
        .replace(":generateContent", "");
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return geminiErrorResponse(400, "Invalid JSON body");
    }

    if (isGeminiNativeTtsRequest(model, body)) {
      return await forwardGeminiNativeRequest(request, body, model, action);
    }

    // Streaming is determined by URL action suffix:
    //   :streamGenerateContent => stream: true  (SSE)
    //   :generateContent       => stream: false (plain JSON)
    const stream = action === ":streamGenerateContent";

    // Convert Gemini request format to OpenAI/internal format
    const convertedBody = convertGeminiToInternal(body, model, stream);

    // Create new request with converted body
    const newRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(convertedBody),
    });

    const response = await handleChat(newRequest);

    if (stream) {
      // Transform OpenAI SSE => Gemini SSE on the fly.
      // The @google/genai SDK always uses :streamGenerateContent?alt=sse and
      // expects Gemini SSE chunks (no [DONE] sentinel — stream just closes).
      return transformOpenAISSEToGeminiSSE(response, model);
    } else {
      // Convert OpenAI JSON response => Gemini GenerateContentResponse
      return await convertOpenAIResponseToGemini(response, model);
    }
  } catch (error) {
    console.log("Error handling Gemini request:", error);
    return geminiErrorResponse(500, error.message);
  }
}

/** Gemini-shaped {error:{code,message,status}} JSON error with CORS. */
function geminiErrorResponse(status, message) {
  return Response.json(buildErrorBody(status, message, FORMATS.GEMINI), {
    status,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

function normalizeGeminiNativeModel(model) {
  return String(model || "")
    .replace(/^models\//, "")
    .replace(/^gemini\//, "");
}

function getGeminiTtsModelIds() {
  return new Set([
    ...(PROVIDER_MODELS.gemini || [])
      .filter((model) => (model.kind || model.type) === "tts")
      .map((model) => model.id),
    ...(PROVIDER_MODELS["gemini-tts-models"] || []).map((model) => model.id),
  ]);
}

function hasAudioResponseModality(body) {
  const modalities = body?.generationConfig?.responseModalities;
  return Array.isArray(modalities)
    && modalities.some((modality) => String(modality).toUpperCase() === "AUDIO");
}

function isGeminiNativeTtsRequest(model, body) {
  const rawModel = String(model || "");
  if (rawModel.includes("/") && !rawModel.startsWith("gemini/") && !rawModel.startsWith("models/")) {
    return false;
  }

  const modelId = normalizeGeminiNativeModel(model);
  return hasAudioResponseModality(body) || getGeminiTtsModelIds().has(modelId);
}

function buildGeminiNativeUrl(requestUrl, model, action) {
  const sourceUrl = new URL(requestUrl);
  const upstreamUrl = new URL(`${GEMINI_NATIVE_BASE_URL}/${normalizeGeminiNativeModel(model)}${action}`);

  for (const [key, value] of sourceUrl.searchParams.entries()) {
    if (key === "key") continue;
    upstreamUrl.searchParams.append(key, value);
  }

  return upstreamUrl.toString();
}

async function validateGeminiNativeClientKey(request) {
  const settings = await getSettings();
  if (!settings.requireApiKey) return null;

  const apiKey = extractClientApiKey(request);
  if (!apiKey) {
    return geminiErrorResponse(401, "Missing API key");
  }

  const valid = await isValidApiKey(apiKey);
  if (!valid) {
    return geminiErrorResponse(401, "Invalid API key");
  }

  return null;
}

function buildGeminiNativeAuthHeaders(credentials) {
  if (credentials?.apiKey) return { "x-goog-api-key": credentials.apiKey };
  if (credentials?.accessToken) return { Authorization: `Bearer ${credentials.accessToken}` };
  return null;
}

function corsHeadersFrom(response) {
  const headers = new Headers(response.headers);
  // Node fetch may expose a decoded body while preserving upstream compression
  // headers. Forwarding those headers makes clients decompress plain bytes again.
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.set("Access-Control-Allow-Origin", "*");
  if ((headers.get("content-type") || "").includes("text/event-stream")) {
    for (const [k, v] of Object.entries(SSE_NO_COMPRESS_HEADERS)) headers.set(k, v);
  }
  return headers;
}

function getSafeGeminiConnectionLabel(credentials) {
  const connectionId = String(credentials?.connectionId || "unknown");
  const shortId = connectionId.slice(0, 8);
  const connectionName = String(credentials?.connectionName || "");
  if (!connectionName || connectionName.includes("@")) return shortId;
  return `${connectionName}:${shortId}`;
}

function getGeminiNativeErrorCode(error) {
  return error?.cause?.code || error?.code || error?.cause?.name || error?.name || "UNKNOWN";
}

function isGeminiNativeTimeoutError(error, timedOut) {
  if (timedOut) return true;
  const code = getGeminiNativeErrorCode(error);
  return code === "UND_ERR_HEADERS_TIMEOUT" || code === "HeadersTimeoutError";
}

function getSafeGeminiNativeErrorText(error) {
  const message = error?.message || String(error);
  const code = getGeminiNativeErrorCode(error);
  return `${message} (${code})`;
}

async function forwardGeminiNativeRequest(request, body, model, action) {
  const authError = await validateGeminiNativeClientKey(request);
  if (authError) return authError;

  const modelId = normalizeGeminiNativeModel(model);
  if (!GEMINI_NATIVE_MODEL_PATTERN.test(modelId)) {
    return geminiErrorResponse(400, "Invalid model");
  }

  // Per-key access control: this path calls Gemini directly (not via handleChat),
  // so restricted keys are checked here, before any credential lookup.
  const keyAccessDenied = await enforceKeyAccessResolved(await getKeyAccessContext(request), model, "gemini", modelId);
  if (keyAccessDenied) return keyAccessDenied;
  const excludeConnectionIds = new Set();
  const bodyText = JSON.stringify(body);
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials("gemini", excludeConnectionIds, modelId);
    if (!credentials || credentials.allRateLimited) {
      console.log(`[GEMINI_NATIVE] exhausted model=${modelId} status=${lastStatus || Number(credentials?.lastErrorCode) || 503} error=${lastError || credentials?.lastError || "No active credentials for provider: gemini"}`);
      return geminiErrorResponse(
        lastStatus || Number(credentials?.lastErrorCode) || 503,
        lastError || credentials?.lastError || "No active credentials for provider: gemini"
      );
    }

    const authHeaders = buildGeminiNativeAuthHeaders(credentials);
    if (!authHeaders) {
      return geminiErrorResponse(404, "No Gemini API key configured");
    }

    const safeConnection = getSafeGeminiConnectionLabel(credentials);
    const startedAt = Date.now();
    const upstreamUrl = buildGeminiNativeUrl(request.url, modelId, action);
    const attemptController = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      attemptController.abort();
    }, GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS);
    const abortAttempt = () => attemptController.abort();

    if (request.signal?.aborted) {
      console.log(`[GEMINI_NATIVE] client aborted model=${modelId} ms=0 conn=${safeConnection}`);
      return geminiErrorResponse(499, "Client closed request");
    }

    request.signal?.addEventListener("abort", abortAttempt, { once: true });
    console.log(`[GEMINI_NATIVE] start model=${modelId} action=${action} conn=${safeConnection} body=${Buffer.byteLength(bodyText)}B timeout=${GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS}`);

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          "Content-Type": request.headers.get("Content-Type") || "application/json",
          ...authHeaders,
        },
        body: bodyText,
        signal: attemptController.signal,
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      if (request.signal?.aborted && !timedOut) {
        console.log(`[GEMINI_NATIVE] client aborted model=${modelId} ms=${durationMs} conn=${safeConnection}`);
        return geminiErrorResponse(499, "Client closed request");
      }

      const status = isGeminiNativeTimeoutError(error, timedOut) ? 504 : 502;
      const errorText = getSafeGeminiNativeErrorText(error);
      console.log(`[GEMINI_NATIVE] fetch failed model=${modelId} status=${status} ms=${durationMs} conn=${safeConnection} error=${errorText}`);

      const { shouldFallback } = await markAccountUnavailable(
        credentials.connectionId,
        status,
        errorText,
        "gemini",
        modelId
      );

      if (shouldFallback) {
        excludeConnectionIds.add(credentials.connectionId);
        lastError = errorText;
        lastStatus = status;
        console.log(`[GEMINI_NATIVE] fallback model=${modelId} status=${status} conn=${safeConnection} exclude=${excludeConnectionIds.size}`);
        continue;
      }

      return geminiErrorResponse(status, errorText);
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abortAttempt);
    }

    console.log(`[GEMINI_NATIVE] upstream model=${modelId} status=${upstreamResponse.status} ms=${Date.now() - startedAt} conn=${safeConnection} ct=${upstreamResponse.headers.get("content-type") || "?"} cl=${upstreamResponse.headers.get("content-length") || "?"}`);

    if (upstreamResponse.ok) {
      await clearAccountError(credentials.connectionId, credentials, modelId);
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: corsHeadersFrom(upstreamResponse),
      });
    }

    const errorText = await upstreamResponse.text();
    const { shouldFallback } = await markAccountUnavailable(
      credentials.connectionId,
      upstreamResponse.status,
      errorText,
      "gemini",
      modelId
    );

    if (shouldFallback) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = errorText;
      lastStatus = upstreamResponse.status;
      continue;
    }

    return new Response(errorText, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: corsHeadersFrom(upstreamResponse),
    });
  }
}

/**
 * Convert a Gemini generateContent request into the internal OpenAI Chat shape
 * by reusing the registered gemini→openai request translator, so tools,
 * function call/response parts, inlineData images, stopSequences, response
 * schema and toolConfig all survive.
 *
 * @param {object} geminiBody  - parsed Gemini request body
 * @param {string} model       - resolved model string (e.g. "gemini-pro-high")
 * @param {boolean} stream     - whether to stream (from URL action)
 */
function convertGeminiToInternal(geminiBody, model, stream) {
  return geminiToOpenAIRequest(model, geminiBody, stream);
}

// HTTP status for an in-stream OpenAI error frame (frames carry type/code, not a status).
const STREAM_ERROR_STATUS_BY_TYPE = {
  invalid_request_error: 400,
  authentication_error: 401,
  permission_error: 403,
  billing_error: 402,
  rate_limit_error: 429,
};

function streamErrorStatus(error) {
  if (Number.isInteger(error?.code) && error.code >= 400 && error.code <= 599) return error.code;
  return STREAM_ERROR_STATUS_BY_TYPE[error?.type] || 500;
}

/**
 * Transform an OpenAI SSE stream into a Gemini SSE stream.
 *
 * OpenAI SSE format (what handleChat returns):
 *   data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}
 *   data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{...}}
 *   data: [DONE]
 *
 * Gemini SSE format (what @google/genai SDK expects):
 *   data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hi"}]},"index":0}]}
 *   data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{...}}]},"finishReason":"STOP","index":0}],"usageMetadata":{...}}
 *   (stream closes — no [DONE])
 *
 * Chunk boundaries are arbitrary, so bytes are buffered until a full line is
 * available; a trailing partial line is carried over to the next chunk.
 */
function transformOpenAISSEToGeminiSSE(upstreamResponse, model) {
  if (!upstreamResponse.ok || !upstreamResponse.body) {
    return upstreamResponse;
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state = initState(FORMATS.GEMINI);
  state.model = model;
  let buffer = "";

  const emit = (controller, payload) => {
    controller.enqueue(encoder.encode("data: " + JSON.stringify(payload) + "\r\n\r\n"));
  };

  const processLine = (line, controller) => {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();

    // Drop empty lines and the OpenAI [DONE] sentinel.
    // Gemini SSE ends by stream close, no sentinel needed.
    if (!data || data === "[DONE]") return;

    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    // Mid-stream error frame from the pipeline: re-emit in Gemini's error shape.
    if (parsed.error) {
      const status = streamErrorStatus(parsed.error);
      emit(controller, buildErrorBody(status, parsed.error.message, FORMATS.GEMINI));
      return;
    }

    for (const out of translateResponse(FORMATS.OPENAI, FORMATS.GEMINI, parsed, state)) {
      if (!out.modelVersion) out.modelVersion = model;
      emit(controller, out);
    }
  };

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) processLine(line, controller);
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) processLine(buffer, controller);
      buffer = "";
    },
  });

  return new Response(upstreamResponse.body.pipeThrough(transformStream), {
    status: 200,
    headers: { ...SSE_HEADERS_CORS },
  });
}

/**
 * Convert an OpenAI chat.completion JSON response into a Gemini
 * GenerateContentResponse so that Gemini CLI can parse it.
 */
async function convertOpenAIResponseToGemini(response, model) {
  if (!response.ok) return response;

  let body;
  try {
    body = await response.json();
  } catch {
    return response;
  }

  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  if (body.candidates) return Response.json(body, { headers });

  if (body.error) {
    return Response.json(
      buildErrorBody(response.status, body.error.message, FORMATS.GEMINI),
      { status: response.status, headers }
    );
  }

  if (!body.choices?.length) return Response.json(body, { headers });

  return Response.json(openaiCompletionToGemini(body, model), { headers });
}
