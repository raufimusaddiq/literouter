import { convertResponsesStreamToJson } from "../../transformer/streamToJsonConverter.js";
import { restoreToolNames } from "../../utils/opencodeFingerprint.js";
import { createErrorResult } from "../../utils/error.js";
import { isAbortError, isGatewayTimeout, readBodyBounded } from "../../utils/requestTimeouts.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { FORMATS } from "../../translator/formats.js";
import { openAICompletionToClaudeMessage, responsesToClaudeMessage } from "../../translator/response/nonstream-to-claude.js";
import { PROVIDERS } from "../../config/providers.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { OPENAI_FINISH } from "../../translator/schema/index.js";
import { rewriteResponsesCustomToolOutput } from "../../translator/concerns/responsesFunctionTools.js";
import { extractReasoningText } from "../../translator/concerns/reasoning.js";
import { chatCompletionToResponses, openAICompletionToGemini } from "../../translator/concerns/nonstreamShapes.js";

const isResponsesProvider = (p) => PROVIDERS[p]?.format === FORMATS.OPENAI_RESPONSES;
import { saveRequestDetail } from "@/lib/usageDb.js";

function textFromResponsesMessageItem(item) {
  if (!item?.content || !Array.isArray(item.content)) return "";
  const byType = item.content.find((c) => c.type === "output_text");
  if (typeof byType?.text === "string") return byType.text;
  const anyText = item.content.find((c) => typeof c.text === "string");
  if (typeof anyText?.text === "string") return anyText.text;
  return "";
}

function pickAssistantMessageForChatCompletion(output) {
  if (!Array.isArray(output)) return { msgItem: null, textContent: null };
  const messages = output.filter((item) => item?.type === "message");
  if (messages.length === 0) return { msgItem: null, textContent: null };
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = textFromResponsesMessageItem(messages[i]);
    if (text.length > 0) return { msgItem: messages[i], textContent: text };
  }
  const last = messages[messages.length - 1];
  return { msgItem: last, textContent: textFromResponsesMessageItem(last) };
}


export function parseSSEToOpenAIResponse(rawSSE, fallbackModel) {
  const chunks = [];
  let streamError = null;

  for (const line of String(rawSSE || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload);
      if (chunk?.error) streamError = chunk.error;
      else chunks.push(chunk);
    } catch {}
  }

  if (streamError) return { error: streamError };
  if (chunks.length === 0) return null;

  const first = chunks[0];
  const contentParts = [];
  const reasoningParts = [];
  const toolCallMap = new Map();
  let finishReason = "stop";
  let usage = null;

  for (const chunk of chunks) {
    const choice = chunk?.choices?.[0];
    const delta = choice?.delta || {};
    if (typeof delta.content === "string" && delta.content.length > 0) contentParts.push(delta.content);
    const reasoningText = extractReasoningText(delta);
    if (reasoningText.length > 0) reasoningParts.push(reasoningText);
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk?.usage && typeof chunk.usage === "object") usage = chunk.usage;

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCallMap.has(idx)) {
          toolCallMap.set(idx, { id: tc.id || "", type: "function", function: { name: "", arguments: "" } });
        }
        const existing = toolCallMap.get(idx);
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.function.name += tc.function.name;
        if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
      }
    }
  }

  const message = { role: "assistant", content: contentParts.join("") || (toolCallMap.size > 0 ? null : "") };
  if (reasoningParts.length > 0) message.reasoning_content = reasoningParts.join("");
  if (toolCallMap.size > 0) {
    message.tool_calls = [...toolCallMap.entries()].sort((a, b) => a[0] - b[0]).map(([, tc]) => tc);
  }

  const result = {
    id: first.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: first.created || Math.floor(Date.now() / 1000),
    model: first.model || fallbackModel || "unknown",
    choices: [{ index: 0, message, finish_reason: finishReason }]
  };
  if (usage) result.usage = usage;
  return result;
}

export async function handleForcedSSEToJson({ providerResponse, sourceFormat, targetFormat, provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, customToolNames, toolNameMap, trackDone, reqTag, log, signal }) {
  const contentType = providerResponse.headers.get("content-type") || "";
  const isCodexResponsesApi = isResponsesProvider(provider) || targetFormat === FORMATS.OPENAI_RESPONSES;
  const isSSE = contentType.includes("text/event-stream") || (contentType === "" && isResponsesProvider(provider));
  const isResponsesJson = isCodexResponsesApi && contentType.includes("application/json");
  if (!isSSE && !isResponsesJson) return null;

  trackDone();

  const ctx = {
    provider, model, connectionId,
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null
  };

  if (isCodexResponsesApi) {
    try {
      const jsonResponse = isResponsesJson
        ? JSON.parse((await readBodyBounded(providerResponse, { signal })).replace(/\s*data:\s*\[DONE\]\s*$/, "").trim())
        : await convertResponsesStreamToJson(providerResponse.body, { signal });
      if (body._compact === true && (
        jsonResponse?.object !== "response.compaction"
        || !Array.isArray(jsonResponse.output)
        || !jsonResponse.output.some((item) => item?.type === "compaction" && typeof item.encrypted_content === "string" && item.encrypted_content.length > 0)
      )) {
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Invalid Codex compact response");
      }
      const noOutput = !Array.isArray(jsonResponse?.output) || jsonResponse.output.length === 0;
      if (jsonResponse?.status === "failed" || (jsonResponse?.status === "in_progress" && noOutput)) {
        const upstreamError = jsonResponse.error;
        const message = upstreamError?.message || "Upstream Responses stream ended without a result";
        return createErrorResult(upstreamError?.type === "invalid_request_error" ? HTTP_STATUS.BAD_REQUEST : HTTP_STATUS.BAD_GATEWAY, message);
      }
      if (onRequestSuccess) await onRequestSuccess();

      const usage = jsonResponse.usage || {};
      saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, silent: true, latencyMs: Date.now() - requestStartTime });
      if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency: { total: Date.now() - requestStartTime } }));

      const inTokensForLog = (usage.input_tokens || 0)
        + (usage.cache_read_input_tokens || usage.cached_tokens || 0)
        + (usage.cache_creation_input_tokens || 0);
      const { textContent } = pickAssistantMessageForChatCompletion(jsonResponse.output);
      const totalLatency = Date.now() - requestStartTime;

      saveRequestDetail(buildRequestDetail({
        ...ctx,
        latency: { ttft: totalLatency, total: totalLatency },
        tokens: { prompt_tokens: inTokensForLog, completion_tokens: usage.output_tokens || 0 },
        response: { content: textContent, thinking: null, finish_reason: jsonResponse.status || "unknown" },
        status: "success"
      }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});

      if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
        return { success: true, response: new Response(JSON.stringify(restoreToolNames(jsonResponse, toolNameMap)), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
      }

      if (sourceFormat === FORMATS.CLAUDE) {
        const finalResp = responsesToClaudeMessage({ ...jsonResponse, model: jsonResponse.model || model });
        return { success: true, response: new Response(JSON.stringify(finalResp), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
      }

      const cacheRead = usage.cache_read_input_tokens || usage.cached_tokens || 0;
      const cacheCreate = usage.cache_creation_input_tokens || 0;
      const inTokens = (usage.input_tokens || 0) + cacheRead + cacheCreate;
      const outTokens = usage.output_tokens || 0;
      const cacheDetails = (cacheRead > 0 || cacheCreate > 0)
        ? { prompt_tokens_details: {
              ...(cacheRead > 0 ? { cached_tokens: cacheRead } : {}),
              ...(cacheCreate > 0 ? { cache_creation_tokens: cacheCreate } : {}) } }
        : {};
      let finalResp;

      const toolCalls = (jsonResponse.output || [])
        .filter(item => item.type === "function_call" || item.type === "custom_tool_call")
        .map((item, idx) => ({
          id: item.call_id || `call_${item.name}_${Date.now()}_${idx}`,
          type: "function",
          function: {
            name: item.name,
            arguments: item.type === "custom_tool_call"
              ? JSON.stringify({ input: item.input || "" })
              : (typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {}))
          }
        }));
      const hasToolCalls = toolCalls.length > 0;

      const responseDone = jsonResponse.status === "completed" || jsonResponse.status === "done";
      const finishReason = hasToolCalls
        ? OPENAI_FINISH.TOOL_CALLS
        : (responseDone ? OPENAI_FINISH.STOP : (jsonResponse.status === "incomplete" ? OPENAI_FINISH.LENGTH : (jsonResponse.status || OPENAI_FINISH.STOP)));
      const pivot = {
        id: jsonResponse.id || `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: jsonResponse.created_at || Math.floor(Date.now() / 1000),
        model: jsonResponse.model || model,
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: textContent || (hasToolCalls ? null : ""),
            ...(hasToolCalls ? { tool_calls: toolCalls } : {})
          },
          finish_reason: finishReason
        }],
        usage: { prompt_tokens: inTokens, completion_tokens: outTokens, total_tokens: inTokens + outTokens, ...cacheDetails }
      };

      finalResp = (sourceFormat === FORMATS.ANTIGRAVITY || sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI)
        ? openAICompletionToGemini({ ...pivot, model: pivot.model || model })
        : pivot;

      return { success: true, response: new Response(JSON.stringify(restoreToolNames(finalResp, toolNameMap)), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
    } catch (err) {
      if (isAbortError(err) || isGatewayTimeout(err)) throw err;
      console.error("[ChatCore] Responses API SSE→JSON failed:", err);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Failed to convert streaming response to JSON");
    }
  }

  try {
    const sseText = await readBodyBounded(providerResponse, { signal });
    const parsed = parseSSEToOpenAIResponse(sseText, model);
    if (!parsed) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Invalid SSE response for non-streaming request");
    if (parsed.error) {
      const upstreamStatus = Number(parsed.error.status);
      const status = Number.isInteger(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus <= 599
        ? upstreamStatus
        : HTTP_STATUS.BAD_GATEWAY;
      return createErrorResult(
        status,
        parsed.error.message || "Upstream SSE stream failed"
      );
    }

    if (onRequestSuccess) await onRequestSuccess();

    const usage = parsed.usage || {};
    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, silent: true, latencyMs: Date.now() - requestStartTime });
    if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency: { total: Date.now() - requestStartTime } }));

    const totalLatency = Date.now() - requestStartTime;
    saveRequestDetail(buildRequestDetail({
      ...ctx,
      latency: { ttft: totalLatency, total: totalLatency },
      tokens: usage,
      response: {
        content: parsed.choices?.[0]?.message?.content || null,
        thinking: parsed.choices?.[0]?.message?.reasoning_content || null,
        finish_reason: parsed.choices?.[0]?.finish_reason || "unknown"
      },
      status: "success"
    }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});

    if (usage && Object.keys(usage).length > 0) parsed.usage = usage;

    if (parsed?.choices) {
      for (const choice of parsed.choices) {
        if (choice?.message?.reasoning_content && choice.message.content) {
          delete choice.message.reasoning_content;
        }
      }
    }

    const finalBody = sourceFormat === FORMATS.OPENAI_RESPONSES
      ? rewriteResponsesCustomToolOutput(chatCompletionToResponses(parsed, customToolNames), customToolNames)
      : sourceFormat === FORMATS.CLAUDE
        ? openAICompletionToClaudeMessage(parsed)
        : parsed;

    return { success: true, response: new Response(JSON.stringify(restoreToolNames(finalBody, toolNameMap)), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
  } catch (err) {
    if (isAbortError(err) || isGatewayTimeout(err)) throw err;
    console.error("[ChatCore] Chat Completions SSE→JSON failed:", err);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Failed to convert streaming response to JSON");
  }
}
