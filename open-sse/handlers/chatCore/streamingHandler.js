import { randomUUID } from "node:crypto";
import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger, createResponsesRewriteStreamWithLogger } from "../../utils/stream.js";
import { createResponsesEventRewriter } from "../../translator/concerns/responsesFunctionTools.js";
import { pipeWithDisconnect } from "../../utils/streamHandler.js";
import { PROVIDERS } from "../../config/providers.js";
import { HTTP_STATUS, STREAM_STALL_TIMEOUT_MS, STREAM_STALL_TIMEOUT_FLASH_MS } from "../../config/runtimeConfig.js";
import { buildAbortedResponsesTerminalBytes } from "../../utils/responsesStreamHelpers.js";
import { createErrorResult } from "../../utils/error.js";
import { buildStreamErrorBytes } from "../../utils/streamHelpers.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { saveRequestDetail } from "@/lib/usageDb.js";
import { SSE_HEADERS_CORS as SSE_HEADERS } from "../../utils/sseConstants.js";
import { upstreamResponseHeaders } from "../../utils/upstreamHeaders.js";
import { restoreToolNames } from "../../utils/opencodeFingerprint.js";

const CODEX_SOURCE_TO_TARGET = {
  [FORMATS.OPENAI_RESPONSES]: FORMATS.OPENAI_RESPONSES,
  [FORMATS.CLAUDE]: FORMATS.CLAUDE,
  [FORMATS.ANTIGRAVITY]: FORMATS.ANTIGRAVITY,
  [FORMATS.GEMINI]: FORMATS.ANTIGRAVITY,
  [FORMATS.GEMINI_CLI]: FORMATS.ANTIGRAVITY,
};

function buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, customToolNames, model, connectionId, body, onStreamComplete, apiKey, credentials }) {
  if (toolNameMap?.size && sourceFormat === targetFormat) {
    if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
      const rewriteEvent = (event, data) => ({ event, data: restoreToolNames(data, toolNameMap) });
      return createResponsesRewriteStreamWithLogger(provider, reqLogger, model, connectionId, body, onStreamComplete, apiKey, rewriteEvent);
    }
    return createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, customToolNames, credentials);
  }
  const isDroidCLI = userAgent?.toLowerCase().includes("droid") || userAgent?.toLowerCase().includes("codex-cli");
  const isResponsesProvider = PROVIDERS[provider]?.format === FORMATS.OPENAI_RESPONSES;
  const needsCodexTranslation = isResponsesProvider && targetFormat === FORMATS.OPENAI_RESPONSES && !isDroidCLI;

  if (needsCodexTranslation) {
    const codexTarget = CODEX_SOURCE_TO_TARGET[sourceFormat] || FORMATS.OPENAI;
    return createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, codexTarget, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, customToolNames, credentials);
  }

  if (needsTranslation(targetFormat, sourceFormat)) {
    return createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, customToolNames, credentials);
  }

  if (PROVIDERS[provider]?.quirks?.responsesFunctionToolsOnly && targetFormat === FORMATS.OPENAI_RESPONSES && sourceFormat === FORMATS.OPENAI_RESPONSES) {
    const rewriteEvent = createResponsesEventRewriter(customToolNames);
    return createResponsesRewriteStreamWithLogger(provider, reqLogger, model, connectionId, body, onStreamComplete, apiKey, rewriteEvent);
  }

  return createPassthroughStreamWithLogger(provider, reqLogger, model, connectionId, body, onStreamComplete, apiKey, toolNameMap);
}

const FLASH_MODEL_RE = /deepseek.*flash/i;
export function resolveStallTimeoutMs(provider, model) {
  const providerMs = PROVIDERS[provider]?.stallTimeoutMs;
  if (providerMs) return providerMs;
  return FLASH_MODEL_RE.test(String(model || "")) ? STREAM_STALL_TIMEOUT_FLASH_MS : STREAM_STALL_TIMEOUT_MS;
}

export async function handleStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, userAgent, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, reqLogger, toolNameMap, customToolNames, streamController, onStreamComplete, onStreamAbort, streamDetailId, pxpipe, reqTag, log, credentials }) {
  const upstreamContentType = (providerResponse.headers.get('content-type') || '').toLowerCase();
  if (upstreamContentType && !upstreamContentType.includes('text/event-stream') && !upstreamContentType.includes('application/json')) {
    const bodyText = await providerResponse.text().catch(() => '');
    const titleMatch = bodyText.match(/<title>([^<]+)<\/title>/i);
    const sanitizedTitle = (titleMatch?.[1] || '').replace(/<[^>]*>/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
    const shortMsg = sanitizedTitle
      || (bodyText.length < 200 ? bodyText.replace(/<[^>]*>/g, '').trim().slice(0, 160) : `Upstream returned non-SSE response (${upstreamContentType})`);
    const upstreamStatus = providerResponse.status;
    const looksLikeAuthPage = /log\s?in|sign\s?in|unauthori[sz]ed|authenticat/i.test(`${sanitizedTitle} ${bodyText.slice(0, 2000).replace(/<[^>]*>/g, ' ')}`);
    const status = upstreamStatus >= 400 ? upstreamStatus : (looksLikeAuthPage ? HTTP_STATUS.UNAUTHORIZED : HTTP_STATUS.BAD_GATEWAY);
    const message = `Upstream returned non-SSE response (content-type: ${upstreamContentType}, HTTP ${upstreamStatus}): ${shortMsg}`;
    if (log?.errorLine) log.errorLine(reqTag, "✗", `BLOCKED ${status} · ${provider}/${model} · non-SSE (${upstreamContentType})
    ${shortMsg}`);
    else console.warn(`[STREAM] ${provider} | ${model} | blocked pipe: ${shortMsg} [${status}]`);
    streamController?.handleError?.(new Error(`upstream non-SSE: ${upstreamStatus}`));
    return createErrorResult(status, message);
  }

  let streamAborted = false;
  let successReported = false;
  const onStreamCompleteWrapped = (...args) => {
    try { onStreamComplete?.(...args); } finally {
      if (onRequestSuccess && !streamAborted && !successReported && args[3]?.cancelled !== true) {
        successReported = true;
        Promise.resolve()
          .then(onRequestSuccess)
          .catch(err => console.error("[ChatCore] onRequestSuccess failed:", err?.message || err));
      }
    }
  };
  const onStreamAbortWrapped = (info) => {
    streamAborted = true;
    return onStreamAbort?.(info);
  };

  const transformStream = buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, customToolNames, model, connectionId, body, onStreamComplete: onStreamCompleteWrapped, apiKey, credentials });

  const isResponsesPassthrough = sourceFormat === FORMATS.OPENAI_RESPONSES && targetFormat === FORMATS.OPENAI_RESPONSES;
  const onAbortTerminal = isResponsesPassthrough
    ? buildAbortedResponsesTerminalBytes
    : (message) => buildStreamErrorBytes(HTTP_STATUS.GATEWAY_TIMEOUT, message, sourceFormat);
  const stallTimeoutMs = resolveStallTimeoutMs(provider, model);
  const transformedBody = pipeWithDisconnect(providerResponse, transformStream, streamController, onAbortTerminal, stallTimeoutMs, {
    identity: { requestId: streamDetailId, provider, model, streamKind: `${sourceFormat}->${targetFormat}` },
    onAbort: onStreamAbortWrapped,
    onCancel: () => transformStream.finalizeOnCancel?.(),
  });


  return {
    success: true,
    response: new Response(transformedBody, { headers: { ...SSE_HEADERS, ...upstreamResponseHeaders(providerResponse.headers) } })
  };
}

export function buildOnStreamComplete({ provider, model, connectionId, apiKey, requestStartTime, body, stream, finalBody, translatedBody, clientRawRequest, pxpipe, reqTag, log }) {
  const streamDetailId = randomUUID();
  let settled = false;

  const onStreamAbort = (info) => {
    if (settled) return;
    settled = true;
    const total = Date.now() - requestStartTime;
    const errorText = `stream aborted: ${info.reason}${info.detail ? ` (${info.detail})` : ""} after ${info.elapsedMs}ms, ${info.chunks} chunks, ${info.bytes} bytes`;
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency: { ttft: 0, total },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      providerResponse: `[${errorText}]`,
      response: { content: `[${errorText}]`, thinking: null, type: "streaming", error: info.reason },
      pxpipe,
      status: "error"
    }, { id: streamDetailId })).catch(err => {
      console.error("[RequestDetail] Failed to save aborted stream:", err.message);
    });
    saveUsageStats({ provider, model, tokens: null, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, silent: true, status: "error", error: errorText, latencyMs: total });
  };

  const onStreamComplete = (contentObj, usage, ttftAt, extra) => {
    if (settled) return;
    settled = true;
    const cancelled = extra?.cancelled === true;
    const latency = {
      ttft: ttftAt ? ttftAt - requestStartTime : Date.now() - requestStartTime,
      total: Date.now() - requestStartTime
    };
    const safeContent = contentObj?.content || (cancelled ? "[Cancelled by client before any output]" : "[Empty streaming response]");
    const safeThinking = contentObj?.thinking || null;

    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency,
      tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      providerResponse: safeContent,
      response: { content: safeContent, thinking: safeThinking, type: "streaming", ...(cancelled ? { cancelled: true } : {}) },
      pxpipe,
      status: cancelled ? "client_cancelled" : "success"
    }, { id: streamDetailId })).catch(err => {
      console.error("[RequestDetail] Failed to save streaming request:", err.message);
    });

    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, label: "STREAM USAGE", silent: true, latencyMs: latency.total, ttftMs: ttftAt ? latency.ttft : null });
    if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency }) + (cancelled ? " · CLIENT CANCELLED" : ""));
  };

  return { onStreamComplete, onStreamAbort, streamDetailId };
}
