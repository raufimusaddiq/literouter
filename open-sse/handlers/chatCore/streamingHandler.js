import { randomUUID } from "node:crypto";
import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger, createResponsesRewriteStreamWithLogger } from "../../utils/stream.js";
import { createResponsesEventRewriter } from "../../translator/concerns/responsesFunctionTools.js";
import { pipeWithDisconnect } from "../../utils/streamHandler.js";
import { PROVIDERS } from "../../config/providers.js";
import {
  HTTP_STATUS,
  STREAM_STALL_TIMEOUT_MS,
  STREAM_STALL_TIMEOUT_FLASH_MS,
  STREAM_PRE_CONTENT_TIMEOUT_MS,
  STREAM_PRE_CONTENT_TIMEOUT_FLASH_MS,
} from "../../config/runtimeConfig.js";
import { recordUpstreamStall, recordUpstreamSuccess } from "../../services/upstreamHealth.js";
import { waitForMeaningfulContent } from "../../utils/preContentGate.js";
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

export function resolvePreContentTimeoutMs(provider, model) {
  return FLASH_MODEL_RE.test(String(model || "")) ? STREAM_PRE_CONTENT_TIMEOUT_FLASH_MS : STREAM_PRE_CONTENT_TIMEOUT_MS;
}

export async function handleStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, userAgent, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, reqLogger, toolNameMap, customToolNames, streamController, onStreamComplete, onStreamAbort, streamDetailId, pxpipe, reqTag, log, credentials, allowPreContentFailover = false, preContentTimeoutMs = null, clientSignal = null, disposeUpstreamSignals = null }) {
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
    if (status >= 500) {
      recordUpstreamStall(provider, model, { reason: "non_sse_response", immediate: true });
    }
    disposeUpstreamSignals?.();
    return createErrorResult(status, message);
  }

  let streamAborted = false;
  let stallRecordedImmediate = false;
  let successReported = false;
  let firstContentElapsedMs = 0;
  const onStreamCompleteWrapped = (...args) => {
    const ttftAt = args[2];
    const extra = args[3];
    if (!streamAborted && extra?.cancelled !== true) {
      const measuredTtft = ttftAt ? ttftAt - requestStartTime : 0;
      recordUpstreamSuccess(provider, model, Math.max(measuredTtft, firstContentElapsedMs));
    }
    try { onStreamComplete?.(...args); } finally {
      if (onRequestSuccess && !streamAborted && !successReported && extra?.cancelled !== true) {
        successReported = true;
        Promise.resolve()
          .then(onRequestSuccess)
          .catch(err => console.error("[ChatCore] onRequestSuccess failed:", err?.message || err));
      }
    }
  };
  const onStreamAbortWrapped = (info) => {
    streamAborted = true;
    const reason = info?.reason;
    if (
      reason === "stall_timeout" ||
      reason === "pre_content_stall" ||
      reason === "pre_content_error" ||
      reason === "upstream_terminated" ||
      reason === "stream_error"
    ) {
      const immediate = reason === "pre_content_stall" || reason === "pre_content_error";
      recordUpstreamStall(provider, model, { reason, immediate });
      if (immediate) stallRecordedImmediate = true;
    }
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

  let responseBody = transformedBody;
  if (allowPreContentFailover) {
    const gateTimeoutMs = preContentTimeoutMs ?? resolvePreContentTimeoutMs(provider, model);
    if (gateTimeoutMs > 0) {
      const gated = await waitForMeaningfulContent(transformedBody, {
        sourceFormat,
        timeoutMs: gateTimeoutMs,
        maxWaitMs: Math.min(stallTimeoutMs, Math.max(gateTimeoutMs * 3, gateTimeoutMs)),
        signal: clientSignal,
        isAborted: () => streamAborted,
      });
      if (gated.status === "client_aborted") {
        streamController?.handleDisconnect?.("client_closed");
        streamController?.abort?.();
        disposeUpstreamSignals?.();
        gated.reader?.cancel?.("client_closed").catch(() => {});
        return createErrorResult(499, "Request aborted");
      }
      if (gated.status === "pre_content_stall" || gated.status === "pre_content_error") {
        if (!streamAborted) {
          onStreamAbortWrapped({
            reason: gated.status,
            requestId: streamDetailId,
            provider,
            model,
            streamKind: `${sourceFormat}->${targetFormat}`,
            elapsedMs: gated.elapsedMs,
            timeoutMs: gateTimeoutMs,
            chunks: gated.chunks,
            bytes: gated.bytes,
            sinceLastMs: gated.elapsedMs,
            detail: gated.status === "pre_content_stall"
              ? `no meaningful content for ${gateTimeoutMs}ms`
              : "stream failed before emitting content",
          });
        } else if (!stallRecordedImmediate) {
          recordUpstreamStall(provider, model, { reason: gated.status, immediate: true });
          stallRecordedImmediate = true;
        }
        log?.warn?.("STREAM", `PRE-CONTENT ${gated.status.toUpperCase()} · ${provider}/${model} · ${gated.elapsedMs}ms (${gated.chunks} chunks, ${gated.bytes}B)`);
        streamController?.handleError?.(new Error(gated.status === "pre_content_stall" ? "pre-content stall timeout" : "upstream stream error before content"));
        streamController?.abort?.();
        disposeUpstreamSignals?.();
        gated.reader?.cancel?.(gated.status).catch(() => {});
        return {
          ...createErrorResult(HTTP_STATUS.SERVICE_UNAVAILABLE, `Upstream stalled before emitting content (${provider}/${model}, ${gated.elapsedMs}ms)`),
          preContentStall: true,
        };
      }
      firstContentElapsedMs = Math.max(gated.elapsedMs || 0, Date.now() - requestStartTime);
      responseBody = gated.stream;
    }
  }

  return {
    success: true,
    response: new Response(responseBody, { headers: { ...SSE_HEADERS, ...upstreamResponseHeaders(providerResponse.headers) } })
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
