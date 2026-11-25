import "open-sse/utils/proxyFetch.js";
import { fingerprintKey } from "open-sse/utils/keyFingerprint.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { handleAntigravityQuotaError, clearAntigravityStrikes } from "../services/antigravityQuota.js";
import { getSettings } from "@/lib/db/index.js";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { errorResponse, unavailableResponse, reshapeErrorResponse, resolveErrorFormat } from "open-sse/utils/error.js";
import { upstreamResponseHeaders } from "open-sse/utils/upstreamHeaders.js";
import { handleComboChat, handleFusionChat, detectRequiredCapabilities } from "open-sse/services/combo.js";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping, getActiveAdapterStrategy } from "open-sse/services/capacityAdapter.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS, MAX_COMBO_DEPTH } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";
import { getKeyAccessContext, enforceKeyAccess, enforceKeyBudget, filterAdapterModels } from "../services/keyAccess.js";
import { PROVIDERS } from "open-sse/config/providers.js";
import { isAbortError } from "open-sse/utils/requestTimeouts.js";

const CLIENT_CLOSED_REQUEST = 499;

export async function handleChat(request, clientRawRequest = null) {
  const response = await handleChatInner(request, clientRawRequest);
  if (!response || response.ok || !request?.url) return response;
  const format = resolveErrorFormat(new URL(request.url).pathname);
  return reshapeErrorResponse(response, format);
}

async function handleChatInner(request, clientRawRequest = null) {
  try {
    return await handleChatImpl(request, clientRawRequest);
  } catch (error) {
    if (isAbortError(error) || request?.signal?.aborted) return errorResponse(CLIENT_CLOSED_REQUEST, "Request aborted");
    log.error("CHAT", `Unhandled error: ${error?.stack || error?.message || error}`);
    return errorResponse(HTTP_STATUS.SERVER_ERROR, "Internal gateway error");
  }
}

async function handleChatImpl(request, clientRawRequest = null) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries()),
      signal: request.signal
    };
  }
  if (!clientRawRequest.signal && request.signal) clientRawRequest = { ...clientRawRequest, signal: request.signal };
  const { model: modelStr, contextMarker } = stripModelContextMarker(body.model);
  if (contextMarker) body.model = modelStr;


  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    log.debug("AUTH", `API Key: ${fingerprintKey(apiKey)}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  const keyAccess = await getKeyAccessContext(request);
  const keyAccessDenied = await enforceKeyAccess(keyAccess, modelStr);
  if (keyAccessDenied) return keyAccessDenied;
  const keyBudgetDenied = await enforceKeyBudget(keyAccess);
  if (keyBudgetDenied) return keyBudgetDenied;

  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  const requiredCapabilities = detectRequiredCapabilities(body);

  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    return dispatchCombo({
      modelStr,
      comboModels,
      body,
      settings,
      requiredCapabilities,
      keyAccess,
      clientRawRequest,
      request,
      apiKey,
      chain: [],
    });
  }

  const soloAugmented = await filterAdapterModels(keyAccess, augmentModelsWithCapacityAdapter([modelStr], requiredCapabilities, settings), [modelStr]);
  if (soloAugmented.length > 1) {
    const adapterAdded = soloAugmented.filter((m) => m !== modelStr);
    log.info("CHAT", `Capacity adapter for [${[...requiredCapabilities].join(",")}] on "${modelStr}" → trying ${soloAugmented.join(", ")}`);
    return handleComboChat({
      body,
      models: soloAugmented,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy: getActiveAdapterStrategy(requiredCapabilities, settings),
      signal: request.signal
    });
  }

  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey);
}

async function dispatchCombo({
  modelStr,
  comboModels,
  body,
  settings,
  requiredCapabilities,
  keyAccess,
  clientRawRequest,
  request,
  apiKey,
  chain,
}) {
  if (chain.includes(modelStr)) {
    const path = [...chain, modelStr].join(" -> ");
    log.warn("CHAT", `Combo cycle detected: ${path}`);
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Combo cycle detected: ${path}`);
  }
  if (chain.length >= MAX_COMBO_DEPTH) {
    log.warn("CHAT", `Combo nesting too deep: ${[...chain, modelStr].join(" -> ")}`);
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Combo nesting deeper than ${MAX_COMBO_DEPTH} levels`);
  }

  const nextChain = [...chain, modelStr];
  const comboStrategies = settings.comboStrategies || {};
  const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
  const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
  const augmentedModels = await filterAdapterModels(
    keyAccess,
    augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, settings),
    comboModels
  );
  const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

  if (comboStrategy === "fusion") {
    log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
    return handleFusionChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m, isPanel) => {
        let cleanRawReq = clientRawRequest;
        if (isPanel && clientRawRequest) {
          const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
          cleanRawReq = { ...clientRawRequest, body: cleanBody };
        }
        return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, nextChain);
      },
      log,
      comboName: modelStr,
      signal: request?.signal,
      judgeModel: comboStrategies[modelStr]?.judgeModel,
      tuning: comboStrategies[modelStr]?.fusionTuning,
    });
  }

  const comboStickyLimit = settings.comboStickyRoundRobinLimit;
  log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
  return handleComboChat({
    body,
    models: augmentedModels,
    handleSingleModel: withCapacityAdapterStripping(
      (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, nextChain),
      adapterAdded
    ),
    log,
    comboName: modelStr,
    comboStrategy,
    comboStickyLimit,
    signal: request?.signal,
  });
}

async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, chain = []) {
  const modelInfo = await getModelInfo(modelStr);

  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);
    if (comboModels) {
      const chatSettings = await getSettings();
      const keyAccess = await getKeyAccessContext(request);
      return dispatchCombo({
        modelStr,
        comboModels,
        body,
        settings: chatSettings,
        requiredCapabilities: detectRequiredCapabilities(body),
        keyAccess,
        clientRawRequest,
        request,
        apiKey,
        chain,
      });
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;
  if (PROVIDERS[provider]?.format === "systemone" || provider.startsWith("systemone-")) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `${provider} only supports System One; use POST /v1/systemone`);
  }


  const userAgent = request?.headers?.get("user-agent") || "";

  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  let lastHeaders = null;

  const maxAccountAttempts = Math.max(1, Number(process.env.MAX_ACCOUNT_FALLBACK_ATTEMPTS) || 10);
  let accountAttempts = 0;

  while (true) {
    if (request?.signal?.aborted) return errorResponse(CLIENT_CLOSED_REQUEST, "Request aborted");
    if (++accountAttempts > maxAccountAttempts) {
      log.warn("FALLBACK", `attempt cap ${maxAccountAttempts} reached for ${provider}/${model}`);
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable", lastHeaders);
    }
    let credentials;
    try {
      credentials = await getProviderCredentials(provider, excludeConnectionIds, model);
    } catch (error) {
      log.error("AUTH", `Credential resolution failed for ${provider}: ${error.message}`);
      return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, `Credentials unavailable for provider: ${provider}`);
    }

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman, lastHeaders);
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable", lastHeaders);
    }

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken, provider);
      if (pid) {
        refreshedCredentials.projectId = pid;
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    const chatSettings = await getSettings();
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    const result = await handleChatCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      rtkEnabled: !!chatSettings.rtkEnabled,
      headroomEnabled: !!chatSettings.headroomEnabled,
      headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
      headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
      headroomTimeoutMs: chatSettings.headroomTimeoutMs,
      cavemanEnabled: !!chatSettings.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: !!chatSettings.ponytailEnabled,
      ponytailLevel: chatSettings.ponytailLevel || "full",
      reaAllowEnabled: !!chatSettings.reaAllowEnabled,
      pxpipeEnabled: !!chatSettings.pxpipeEnabled,
      pxpipeMinChars: chatSettings.pxpipeMinChars,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
      pxpipeTransform: chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null,
      onPxpipeEvent: appendPxpipeEvent,
      providerThinking,
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
        clearAntigravityStrikes(credentials.connectionId, model);
      }
    });

    if (result.success) return result.response;

    if (result.status === CLIENT_CLOSED_REQUEST || request?.signal?.aborted || result.status === HTTP_STATUS.GATEWAY_TIMEOUT) {
      return result.response;
    }

    let quotaResetMs = null;
    let resetsAtMs = result.resetsAtMs;
    if (provider === "antigravity" && (result.status === 409 || result.status === 429)) {
      quotaResetMs = await handleAntigravityQuotaError(
        credentials.connectionId, result.status, model,
        refreshedCredentials.accessToken, credentials.providerSpecificData
      );
      if (quotaResetMs) resetsAtMs = quotaResetMs;
    }

    const shouldFallback = provider === "antigravity" && quotaResetMs
      ? true
      : (await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, resetsAtMs)).shouldFallback;

    if (shouldFallback) {
      log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      lastHeaders = upstreamResponseHeaders(result.response?.headers);
      continue;
    }

    return result.response;
  }
}
