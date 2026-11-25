import { getSettings, getProviderNodeById, getProviderNodes } from "@/lib/db/index.js";
import { SSE_NO_COMPRESS_HEADERS } from "open-sse/utils/sseConstants.js";
import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { PROVIDERS } from "open-sse/config/providers.js";
import { getModelsByProviderId } from "open-sse/config/providerModels.js";
import { getKeyAccessContext, enforceKeyAccessResolved, enforceKeyAccess, enforceKeyBudget } from "../services/keyAccess.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { extractUsageFromResponse, saveUsageStats } from "open-sse/handlers/chatCore/requestDetail.js";
import { trackPendingRequest } from "@/lib/usageDb.js";

const FALLBACK_STATUSES = new Set([401, 403, 408, 429, 500, 502, 503, 504, 529]);

export const FORWARDED_REQUEST_HEADERS = [
  "TypeSafe-Danger-Zone-Images",
  "TypeSafe-Danger-Zone-Long-Context",
];

export function pickForwardedHeaders(request) {
  const headers = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}

export function systemOneError(status, message, headers = {}) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...headers },
  });
}

export async function normalizeSystemOneRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be a JSON object" };
  }

  const rawModel = typeof body.model === "string" ? body.model.trim() : "";
  if (!rawModel) return { error: "Missing model" };

  const [prefix, ...rest] = rawModel.split("/");
  const provider = rest.length
    ? (isCustomSystemOneProvider(prefix) ? prefix : await resolveSystemOneNodeByPrefix(prefix) || prefix)
    : "typesafe";
  const model = rest.length ? rest.join("/") : rawModel;
  const config = PROVIDERS[provider];
  const isCustomNode = isCustomSystemOneProvider(provider);
  if (!model || (!config?.systemOneTransport && config?.format !== "systemone" && config?.format !== "openai" && !isCustomNode)) {
    return { error: `Unsupported System One provider or model: ${rawModel}` };
  }
  const entry = isCustomNode ? null : getModelsByProviderId(provider).find((candidate) => candidate.id === model);
  if (!isCustomNode && !entry) {
    return { error: `Unsupported model for ${provider}: ${model}` };
  }
  if (!Object.prototype.hasOwnProperty.call(body, "state")) {
    return { error: "Missing state" };
  }
  const shape = entry ? entry.payloadShape || "questions" : null;
  if (shape) {
    if (!isNonEmptyMap(body[shape])) return { error: `${shape} must be a non-empty object` };
  } else if (!isNonEmptyMap(body.questions) && !isNonEmptyMap(body.fields)) {
    return { error: "questions or fields must be a non-empty object" };
  }

  const upstreamModel = config?.systemOneTransport && entry?.upstreamModelId ? entry.upstreamModelId : model;
  return { provider, model, body: { ...body, model: upstreamModel } };
}

function isNonEmptyMap(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

export function unwrapSystemOneEnvelope(payload, wrapper) {
  const inner = wrapper && payload && typeof payload === "object" ? payload[wrapper] : null;
  if (inner && typeof inner === "object" && inner.answers && !payload.answers) return inner;
  return payload;
}

export function isCustomSystemOneProvider(providerId) {
  return typeof providerId === "string" && providerId.startsWith("systemone-");
}

export async function resolveSystemOneNodeByPrefix(displayPrefix) {
  const nodes = await getProviderNodes({ type: "systemone" });
  const node = nodes.find((n) => n.prefix === displayPrefix);
  return node?.id || null;
}

function copyHeaders(response) {
  const headers = { "Access-Control-Allow-Origin": "*" };
  const excluded = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "content-length", "content-encoding"]);
  response.headers.forEach((value, name) => {
    if (!excluded.has(name.toLowerCase())) headers[name.toLowerCase()] = value;
  });
  if ((headers["content-type"] || "").includes("text/event-stream")) {
    for (const [k, v] of Object.entries(SSE_NO_COMPRESS_HEADERS)) headers[k.toLowerCase()] = v;
  }
  return headers;
}

async function readFailure(response) {
  const text = await response.text().catch(() => "");
  let message = text || `Upstream error: ${response.status}`;
  try {
    const parsed = JSON.parse(text);
    message = parsed?.error?.message || parsed?.message || message;
  } catch {}
  return { text, message };
}

function recordSystemOneUsage(payload, provider, model, connectionId, apiKey) {
  try {
    const usage = extractUsageFromResponse(payload);
    saveUsageStats({
      provider,
      model,
      tokens: usage,
      connectionId,
      apiKey,
      endpoint: "/v1/systemone",
      silent: true,
    });
  } catch {}
}

export async function handleSystemOne(request) {
  let parsedBody;
  try {
    parsedBody = await request.json();
  } catch {
    return systemOneError(400, "Invalid JSON body");
  }
  const clientApiKey = extractApiKey(request);
  const settings = await getSettings();
  if (settings.requireApiKey && (!clientApiKey || !(await isValidApiKey(clientApiKey)))) {
    return systemOneError(401, clientApiKey ? "Invalid API key" : "Missing API key");
  }

  const keyAccess = await getKeyAccessContext(request);
  const rawModel = typeof parsedBody?.model === "string" ? parsedBody.model.trim() : "";
  const keyAccessDenied = await enforceKeyAccess(keyAccess, rawModel);
  if (keyAccessDenied) return keyAccessDenied;
  const keyBudgetDenied = await enforceKeyBudget(keyAccess);
  if (keyBudgetDenied) return keyBudgetDenied;

  const input = await normalizeSystemOneRequest(parsedBody);
  if (input.error) return systemOneError(400, input.error);

  const { provider, model, body } = input;
  const resolvedAccessDenied = await enforceKeyAccessResolved(keyAccess, rawModel, provider, model);
  if (resolvedAccessDenied) return resolvedAccessDenied;
  const customNode = isCustomSystemOneProvider(provider) ? await getProviderNodeById(provider) : null;
  if (isCustomSystemOneProvider(provider) && !customNode) {
    return systemOneError(400, `Unknown System One provider: ${provider}`);
  }
  const excluded = new Set();
  let lastFailure = null;
  const maxAttempts = Math.max(1, Number(process.env.MAX_ACCOUNT_FALLBACK_ATTEMPTS) || 10);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const credentials = await getProviderCredentials(provider, excluded, model);
    if (!credentials || credentials.allRateLimited) {
      if (lastFailure) {
        return new Response(lastFailure.text, {
          status: lastFailure.status,
          headers: lastFailure.headers,
        });
      }
      const retryAfter = credentials?.retryAfter
        ? Math.max(Math.ceil((new Date(credentials.retryAfter).getTime() - Date.now()) / 1000), 1)
        : null;
      return systemOneError(429, credentials?.lastError || `No active credentials for provider: ${provider}`, retryAfter ? { "Retry-After": String(retryAfter) } : {});
    }

    const config = customNode
      ? { baseUrl: customNode.baseUrl, format: customNode.apiType === "responses" ? "openai-responses" : "openai" }
      : PROVIDERS[provider];
    const systemOneUrl = config.systemOneTransport
      ? config.systemOneTransport.baseUrl
          .replace("{accountId}", encodeURIComponent(credentials.providerSpecificData?.accountId || ""))
          .replace("{model}", model)
      : config.baseUrl;
    const proxyOptions = credentials.providerSpecificData || null;
    trackPendingRequest(model, provider, credentials.connectionId, true);
    try {
      const response = await proxyAwareFetch(systemOneUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...pickForwardedHeaders(request),
          Authorization: `Bearer ${credentials.apiKey || credentials.accessToken}`,
        },
        body: JSON.stringify(body),
        signal: request.signal,
      }, proxyOptions);

      if (response.ok) {
        await clearAccountError(credentials.connectionId, credentials, model);
        const wrapper = config.systemOneTransport?.responseWrapper;
        if (!wrapper) {
          response.clone().json()
            .then((payload) => recordSystemOneUsage(payload, provider, model, credentials.connectionId, clientApiKey))
            .catch(() => {});
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: copyHeaders(response),
          });
        }
        const text = await response.text();
        let payload = null;
        try {
          payload = JSON.parse(text);
        } catch {}
        const unwrapped = unwrapSystemOneEnvelope(payload, wrapper);
        if (payload) recordSystemOneUsage(unwrapped === payload ? payload[wrapper] ?? payload : unwrapped, provider, model, credentials.connectionId, clientApiKey);
        return new Response(unwrapped === payload ? text : JSON.stringify(unwrapped), {
          status: response.status,
          statusText: response.statusText,
          headers: copyHeaders(response),
        });
      }

      const failure = await readFailure(response);
      lastFailure = { ...failure, status: response.status, headers: copyHeaders(response) };
      if (!FALLBACK_STATUSES.has(response.status)) {
        return new Response(failure.text, { status: response.status, headers: lastFailure.headers });
      }

      const fallback = await markAccountUnavailable(credentials.connectionId, response.status, failure.message, provider, model);
      if (!fallback.shouldFallback) {
        return new Response(failure.text, { status: response.status, headers: lastFailure.headers });
      }
      excluded.add(credentials.connectionId);
    } catch (error) {
      lastFailure = {
        text: JSON.stringify({ error: { message: error.message || "Upstream request failed" } }),
        status: 502,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      };
      const fallback = await markAccountUnavailable(credentials.connectionId, 502, error.message, provider, model);
      if (!fallback.shouldFallback) return new Response(lastFailure.text, { status: 502, headers: lastFailure.headers });
      excluded.add(credentials.connectionId);
    } finally {
      trackPendingRequest(model, provider, credentials.connectionId, false);
    }
  }

  return lastFailure
    ? new Response(lastFailure.text, { status: lastFailure.status, headers: lastFailure.headers })
    : systemOneError(503, "All provider accounts unavailable");
}
