import { getSettings } from "@/lib/localDb";
import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { PROVIDERS } from "open-sse/config/providers.js";
import { getModelsByProviderId } from "open-sse/config/providerModels.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { extractUsageFromResponse, saveUsageStats } from "open-sse/handlers/chatCore/requestDetail.js";
import { trackPendingRequest } from "@/lib/usageDb.js";

const FALLBACK_STATUSES = new Set([401, 403, 408, 429, 500, 502, 503, 504, 529]);

export function systemOneError(status, message, headers = {}) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...headers },
  });
}

export function normalizeSystemOneRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be a JSON object" };
  }

  const rawModel = typeof body.model === "string" ? body.model.trim() : "";
  if (!rawModel) return { error: "Missing model" };

  const [prefix, ...rest] = rawModel.split("/");
  const provider = rest.length ? prefix : "typesafe";
  const model = rest.length ? rest.join("/") : rawModel;
  if (!model || PROVIDERS[provider]?.format !== "systemone") {
    return { error: `Unsupported System One provider or model: ${rawModel}` };
  }
  if (!getModelsByProviderId(provider).some((entry) => entry.id === model)) {
    return { error: `Unsupported model for ${provider}: ${model}` };
  }
  if (!Object.prototype.hasOwnProperty.call(body, "state")) {
    return { error: "Missing state" };
  }
  if (!body.questions || typeof body.questions !== "object" || Array.isArray(body.questions) || Object.keys(body.questions).length === 0) {
    return { error: "questions must be a non-empty object" };
  }

  return { provider, model, body: { ...body, model } };
}

function copyHeaders(response) {
  const headers = { "Access-Control-Allow-Origin": "*" };
  // Hop-by-hop/body-affecting headers are unsafe to forward; everything else is pass-through.
  const excluded = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "content-length", "content-encoding"]);
  response.headers.forEach((value, name) => {
    if (!excluded.has(name.toLowerCase())) headers[name.toLowerCase()] = value;
  });
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

async function recordSystemOneUsage(response, provider, model, connectionId, apiKey) {
  try {
    const usage = extractUsageFromResponse(await response.clone().json());
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
  let input;
  try {
    input = normalizeSystemOneRequest(await request.json());
  } catch {
    return systemOneError(400, "Invalid JSON body");
  }
  if (input.error) return systemOneError(400, input.error);

  const clientApiKey = extractApiKey(request);
  const settings = await getSettings();
  if (settings.requireApiKey && (!clientApiKey || !(await isValidApiKey(clientApiKey)))) {
    return systemOneError(401, clientApiKey ? "Invalid API key" : "Missing API key");
  }

  const { provider, model, body } = input;
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

    const config = PROVIDERS[provider];
    const proxyOptions = credentials.providerSpecificData || null;
    trackPendingRequest(model, provider, credentials.connectionId, true);
    try {
      const response = await proxyAwareFetch(config.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credentials.apiKey || credentials.accessToken}`,
        },
        body: JSON.stringify(body),
        signal: request.signal,
      }, proxyOptions);

      if (response.ok) {
        await clearAccountError(credentials.connectionId, credentials, model);
        recordSystemOneUsage(response, provider, model, credentials.connectionId, clientApiKey);
        return new Response(response.body, {
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
