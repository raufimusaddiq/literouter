import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { openAICompletionToClaudeMessage } from "../../translator/response/nonstream-to-claude.js";
import { ollamaBodyToOpenAI } from "../../translator/response/ollama-to-openai.js";
import { toOpenAIUsage } from "../../translator/concerns/usage.js";
import { filterUsageForFormat } from "../../utils/usageTracking.js";
import { createErrorResult } from "../../utils/error.js";
import { isAbortError, isGatewayTimeout, readBodyBounded } from "../../utils/requestTimeouts.js";
import { upstreamResponseHeaders } from "../../utils/upstreamHeaders.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { parseSSEToOpenAIResponse } from "./sseToJsonHandler.js";
import { unwrapClineEnvelope } from "../../shared/clineEnvelope.js";
import { buildRequestDetail, extractRequestConfig, extractUsageFromResponse, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { saveRequestDetail } from "@/lib/usageDb.js";
import { decloakToolNames } from "../../utils/claudeCloaking.js";
import { restoreToolNames } from "../../utils/opencodeFingerprint.js";
import { ROLE, RESPONSES_ITEM, OPENAI_FINISH } from "../../translator/schema/index.js";
import { toOpenAIFinish } from "../../translator/concerns/finishReason.js";
import { chatCompletionToResponses, openAICompletionToGemini } from "../../translator/concerns/nonstreamShapes.js";
import { rewriteResponsesCustomToolOutput } from "../../translator/concerns/responsesFunctionTools.js";
import { PROVIDERS } from "../../config/providers.js";

/**
 * Convert an OpenAI Responses non-streaming response body into the OpenAI
 * Chat Completions shape. Streaming already emits Chat chunks for Chat clients.
 */
function responsesToOpenAICompletion(responseBody) {
  if (!Array.isArray(responseBody?.output)) return responseBody;

  let text = "";
  let reasoning = "";
  const toolCalls = [];

  for (const item of responseBody.output) {
    if (item?.type === RESPONSES_ITEM.MESSAGE) {
      for (const part of item.content || []) {
        if (part?.type === RESPONSES_ITEM.OUTPUT_TEXT && typeof part.text === "string") text += part.text;
      }
    } else if (item?.type === RESPONSES_ITEM.REASONING) {
      for (const part of item.summary || []) {
        if (typeof part?.text === "string") reasoning += part.text;
      }
    } else if (item?.type === RESPONSES_ITEM.FUNCTION_CALL || item?.type === RESPONSES_ITEM.CUSTOM_TOOL_CALL) {
      toolCalls.push({
        id: item.call_id || item.id || `call_${toolCalls.length}`,
        type: "function",
        function: {
          name: item.name || "",
          arguments: item.type === RESPONSES_ITEM.CUSTOM_TOOL_CALL
            ? JSON.stringify({ input: item.input || "" })
            : (typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {})),
        },
      });
    }
  }

  const message = { role: ROLE.ASSISTANT, content: text };
  if (reasoning) message.reasoning_content = reasoning;
  if (toolCalls.length) message.tool_calls = toolCalls;

  const usage = responseBody.usage || {};
  return {
    id: String(responseBody.id || `resp_${Date.now()}`).replace(/^resp_/, "chatcmpl-"),
    object: "chat.completion",
    created: responseBody.created_at || Math.floor(Date.now() / 1000),
    model: responseBody.model || "unknown",
    choices: [{
      index: 0,
      message,
      finish_reason: toolCalls.length ? "tool_calls" : (responseBody.status === "incomplete" ? "length" : "stop"),
    }],
    usage: {
      prompt_tokens: usage.input_tokens || 0,
      completion_tokens: usage.output_tokens || 0,
      total_tokens: usage.total_tokens || (usage.input_tokens || 0) + (usage.output_tokens || 0),
    },
  };
}

const GEMINI_FORMATS = new Set([FORMATS.GEMINI, FORMATS.ANTIGRAVITY, FORMATS.GEMINI_CLI, FORMATS.VERTEX]);

/**
 * Translate non-streaming response body from provider format → client format.
 * Provider bodies pivot through OpenAI Chat Completions, then one final
 * OpenAI → client step runs, so Claude and Gemini clients get their own body
 * shape instead of a chat.completion they cannot parse.
 */
export function translateNonStreamingResponse(responseBody, targetFormat, sourceFormat, customToolNames = null) {
  if (targetFormat === sourceFormat) return responseBody;
  return pivotToClientShape(translateToPivot(responseBody, targetFormat), sourceFormat, customToolNames);
}

// Provider body → OpenAI Chat Completions (the hub format).
function translateToPivot(responseBody, providerFormat) {
  // Responses-native upstream: its `output` items carry everything the pivot needs.
  if (providerFormat === FORMATS.OPENAI_RESPONSES) return responsesToOpenAICompletion(responseBody);
  // OpenAI-native upstream: already the pivot.
  if (providerFormat === FORMATS.OPENAI) return responseBody;

  // Gemini / Antigravity
  if (GEMINI_FORMATS.has(providerFormat)) {
    const response = responseBody.response || responseBody;
    if (!response?.candidates?.[0]) return responseBody;

    const candidate = response.candidates[0];
    const content = candidate.content;
    const usage = response.usageMetadata || responseBody.usageMetadata;
    let textContent = "", reasoningContent = "";
    const toolCalls = [];

    if (content?.parts) {
      for (const part of content.parts) {
        if (part.thought === true && part.text) reasoningContent += part.text;
        else if (part.text !== undefined) textContent += part.text;
        if (part.functionCall) {
          toolCalls.push({
            id: `call_${part.functionCall.name}_${Date.now()}_${toolCalls.length}`,
            type: "function",
            function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args || {}) }
          });
        }
        // Handle inline image data (from image generation models)
        const inlineData = part.inlineData || part.inline_data;
        if (inlineData?.data) {
          const mimeType = inlineData.mimeType || inlineData.mime_type || "image/png";
          textContent += `\n![image](data:${mimeType};base64,${inlineData.data})\n`;
        }
      }
    }

    const message = { role: "assistant" };
    if (textContent) message.content = textContent;
    if (reasoningContent) message.reasoning_content = reasoningContent;
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    if (!message.content && !message.tool_calls) message.content = "";

    // Shared mapping, so MAX_TOKENS→length and SAFETY→content_filter match the
    // streaming path instead of leaking "max_tokens"/"safety" to the client.
    let finishReason = toOpenAIFinish(candidate.finishReason || "stop", FORMATS.GEMINI);
    if (finishReason === OPENAI_FINISH.STOP && toolCalls.length > 0) finishReason = OPENAI_FINISH.TOOL_CALLS;

    const result = {
      id: `chatcmpl-${response.responseId || Date.now()}`,
      object: "chat.completion",
      created: Math.floor(new Date(response.createTime || Date.now()).getTime() / 1000),
      model: response.modelVersion || "gemini",
      choices: [{ index: 0, message, finish_reason: finishReason }]
    };

    if (usage) {
      result.usage = {
        prompt_tokens: (usage.promptTokenCount || 0) + (usage.thoughtsTokenCount || 0),
        completion_tokens: usage.candidatesTokenCount || 0,
        total_tokens: usage.totalTokenCount || 0
      };
      if (usage.thoughtsTokenCount > 0) {
        result.usage.completion_tokens_details = { reasoning_tokens: usage.thoughtsTokenCount };
      }
    }
    return result;
  }

  // Claude
  if (providerFormat === FORMATS.CLAUDE) {
    // Always translate a Claude-format body to OpenAI, even if `content` is
    // missing/null (e.g. M3 with max_tokens:1 spends the budget on thinking
    // and returns `content: null`). Returning the raw body would leave the
    // client without a `choices` array and surface as a UI test error.
    // Early return if the response is already in OpenAI format (has choices array)
    // or if it has content as a non-array value (likely a different non-Claude format).
    // Some providers (e.g. xiaomi-tokenplan) return OpenAI-format responses even when
    // the request was translated to Claude format — the provider format is Claude but
    // the actual body is OpenAI-native and needs no further translation.
    if (responseBody.choices || (responseBody.content && !Array.isArray(responseBody.content))) return responseBody;

    let textContent = "", thinkingContent = "";
    const toolCalls = [];

    for (const block of (responseBody.content || [])) {
      if (block.type === "text") {
        // Strip markdown code block markers only when the provider wrapped the
        // whole answer in a ```json fence (e.g. kimi). An unrelated trailing
        // fence (a python snippet ending a normal answer) must survive.
        const raw = block.text ?? "";
        const leadingFence = /^\s*```\s*json\s*\n?/i;
        textContent += leadingFence.test(raw)
          ? raw.replace(leadingFence, "").replace(/\n?\s*```\s*$/i, "")
          : raw;
      } else if (block.type === "thinking") thinkingContent += block.thinking || "";
      else if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input || {}) } });
      }
    }

    const message = { role: "assistant" };
    if (textContent) message.content = textContent;
    if (thinkingContent) message.reasoning_content = thinkingContent;
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    if (!message.content && !message.tool_calls) message.content = "";

    // max_tokens→length and refusal→content_filter: same mapping as streaming.
    let finishReason = toOpenAIFinish(responseBody.stop_reason || "stop", FORMATS.CLAUDE);
    if (finishReason === OPENAI_FINISH.STOP && toolCalls.length > 0) finishReason = OPENAI_FINISH.TOOL_CALLS;

    const result = {
      id: `chatcmpl-${responseBody.id || Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: responseBody.model || "claude",
      choices: [{ index: 0, message, finish_reason: finishReason }]
    };

    if (responseBody.usage) {
      // Same Claude -> OpenAI usage math as the streaming path: prompt includes
      // cache read + write, and the split rides in prompt_tokens_details (#130).
      result.usage = toOpenAIUsage(responseBody.usage, "claude");
    }
    return result;
  }

  // Ollama
  if (providerFormat === FORMATS.OLLAMA) return ollamaBodyToOpenAI(responseBody);

  return responseBody;
}

// OpenAI Chat Completions → the body shape the client asked for.
function pivotToClientShape(pivot, clientFormat, customToolNames) {
  if (clientFormat === FORMATS.OPENAI) return pivot;
  if (clientFormat === FORMATS.OPENAI_RESPONSES) return chatCompletionToResponses(pivot, customToolNames);
  if (clientFormat === FORMATS.CLAUDE) return openAICompletionToClaudeMessage(pivot);
  if (GEMINI_FORMATS.has(clientFormat)) return openAICompletionToGemini(pivot);
  return pivot;
}

/**
 * Handle non-streaming response from provider.
 */
export async function handleNonStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, reqLogger, toolNameMap, customToolNames, trackDone, pxpipe, reqTag, log, signal }) {
  trackDone();
  const contentType = providerResponse.headers.get("content-type") || "";
  let responseBody;
  if (body._compact === true && contentType.includes("text/event-stream")) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Expected JSON from Codex compact endpoint");
  }

  if (contentType.includes("text/event-stream")) {
    const sseText = await readBodyBounded(providerResponse, { signal });
    const parsed = parseSSEToOpenAIResponse(sseText, model);
    if (!parsed) {
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Invalid SSE response for non-streaming request");
    }
    if (parsed.error) {
      const upstreamStatus = Number(parsed.error.status);
      const status = Number.isInteger(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus <= 599
        ? upstreamStatus
        : HTTP_STATUS.BAD_GATEWAY;
      return createErrorResult(status, parsed.error.message || "Upstream SSE stream failed");
    }
    responseBody = parsed;
  } else {
    try {
      responseBody = JSON.parse(await readBodyBounded(providerResponse, { signal }));
    } catch (err) {
      if (isAbortError(err) || isGatewayTimeout(err)) throw err; // body read cut by client abort / timeout
      console.error(`[ChatCore] Failed to parse JSON from ${provider}:`, err.message);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid JSON response from ${provider}`);
    }
  }

  if (body._compact === true && (
    responseBody?.object !== "response.compaction"
    || !Array.isArray(responseBody.output)
    || !responseBody.output.some((item) => item?.type === "compaction" && typeof item.encrypted_content === "string" && item.encrypted_content.length > 0)
  )) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Invalid Codex compact response");
  }

  // Unwrap before any consumer reads choices/usage so non-stream clients get a
  // bare OpenAI body and usage tracking sees data.usage. No-op unless the
  // provider opts in via transport.quirks.clineEnvelope.
  responseBody = unwrapClineEnvelope(responseBody, provider);

  reqLogger.logProviderResponse(providerResponse.status, providerResponse.statusText, providerResponse.headers, responseBody);
  if (onRequestSuccess) {
    Promise.resolve()
      .then(onRequestSuccess)
      .catch(err => {
        console.error("[ChatCore] onRequestSuccess failed:", err?.message || err);
      });
  }

  // Decloak tool_use names once on raw Claude body, before any translation (INPUT side)
  responseBody = decloakToolNames(responseBody, toolNameMap);

  const usage = extractUsageFromResponse(responseBody);
  saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, silent: true, latencyMs: Date.now() - requestStartTime });
  if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency: { total: Date.now() - requestStartTime } }));

  const translatedResponse = needsTranslation(targetFormat, sourceFormat)
    ? translateNonStreamingResponse(responseBody, targetFormat, sourceFormat, customToolNames)
    : responseBody;

  // Quirk providers (kenari /v1/responses): same-format Responses body, but
  // function_call output items for converted custom tools must surface as
  // custom_tool_call so Codex recognizes them.
  if (PROVIDERS[provider]?.quirks?.responsesFunctionToolsOnly && sourceFormat === FORMATS.OPENAI_RESPONSES) {
    rewriteResponsesCustomToolOutput(translatedResponse, customToolNames);
  }
  const isClaudeMessageResponse = sourceFormat === FORMATS.CLAUDE && translatedResponse?.type === "message";
  // Responses-format translation produces a `object:"response"` body with no
  // `choices`; skip the Chat-Completions-specific post-processing below for it.
  const isResponsesResponse = sourceFormat === FORMATS.OPENAI_RESPONSES && (translatedResponse?.object === "response" || translatedResponse?.object === "response.compaction");

  // Fix finish_reason for tool_calls: some providers return non-standard values (e.g. "other")
  if (translatedResponse?.choices?.[0]) {
    const choice = translatedResponse.choices[0];
    const msg = choice.message;
    const hasToolCalls = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0;
    if (hasToolCalls && choice.finish_reason !== "tool_calls") {
      choice.finish_reason = "tool_calls";
    }
  }

  // Ensure OpenAI-required fields
  if (!isClaudeMessageResponse && !isResponsesResponse) {
    if (!translatedResponse.object) translatedResponse.object = "chat.completion";
    if (!translatedResponse.created) translatedResponse.created = Math.floor(Date.now() / 1000);
  }

  // Strip Azure-specific fields
  if (!isClaudeMessageResponse && !isResponsesResponse) {
    delete translatedResponse.prompt_filter_results;
    if (translatedResponse?.choices) {
      for (const choice of translatedResponse.choices) delete choice.content_filter_results;
    }
  }

  if (translatedResponse?.usage && body._compact !== true) {
    translatedResponse.usage = filterUsageForFormat(translatedResponse.usage, sourceFormat);
  }

  // Strip reasoning_content only when content is non-empty.
  // When content is empty (e.g. thinking models that used all tokens for reasoning),
  // reasoning_content is the only useful output and must be preserved.
  if (!isClaudeMessageResponse && !isResponsesResponse && translatedResponse?.choices) {
    for (const choice of translatedResponse.choices) {
      if (choice?.message?.reasoning_content && choice.message.content) {
        delete choice.message.reasoning_content;
      }
    }
  }

  reqLogger.logConvertedResponse(translatedResponse);

  const totalLatency = Date.now() - requestStartTime;
  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId,
    latency: { ttft: totalLatency, total: totalLatency },
    tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null,
    providerResponse: responseBody || null,
    response: {
      content: translatedResponse?.choices?.[0]?.message?.content || translatedResponse?.content || null,
      thinking: translatedResponse?.choices?.[0]?.message?.reasoning_content || translatedResponse?.reasoning_content || null,
      finish_reason: translatedResponse?.choices?.[0]?.finish_reason || "unknown"
    },
    pxpipe,
    status: "success"
  }, { endpoint: clientRawRequest?.endpoint || null })).catch(err => {
    console.error("[RequestDetail] Failed to save:", err.message);
  });

  return {
    success: true,
    response: new Response(JSON.stringify(restoreToolNames(translatedResponse, toolNameMap)), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...upstreamResponseHeaders(providerResponse.headers) }
    })
  };
}
