import { FORMATS } from "../formats.js";
import { GEMINI_ROLE, ROLE, RESPONSES_ITEM, OPENAI_FINISH } from "../schema/index.js";
import { fromOpenAIFinish } from "./finishReason.js";

function extractCustomToolInput(argumentsValue) {
  const argumentsText = typeof argumentsValue === "string" ? argumentsValue : JSON.stringify(argumentsValue || {});
  try {
    const parsed = JSON.parse(argumentsText);
    if (parsed && typeof parsed === "object" && typeof parsed.input === "string") return parsed.input;
  } catch {}
  return argumentsText;
}

export function chatCompletionToResponses(responseBody, customToolNames = null) {
  const choice = responseBody?.choices?.[0];
  if (!choice) return responseBody;

  const message = choice.message || {};
  const output = [];

  const reasoning = message.reasoning_content || message.reasoning;
  if (typeof reasoning === "string" && reasoning.length > 0) {
    output.push({
      type: RESPONSES_ITEM.REASONING,
      summary: [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: reasoning }],
    });
  }

  const text = typeof message.content === "string" ? message.content : "";
  if (text.length > 0) {
    output.push({
      type: RESPONSES_ITEM.MESSAGE,
      role: ROLE.ASSISTANT,
      content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, text, annotations: [] }],
    });
  }

  for (const tc of message.tool_calls || []) {
    const fn = tc.function || {};
    const custom = customToolNames?.has(fn.name);
    output.push({
      type: custom ? RESPONSES_ITEM.CUSTOM_TOOL_CALL : RESPONSES_ITEM.FUNCTION_CALL,
      id: `${custom ? "ctc" : "fc"}_${tc.id || ""}`,
      call_id: tc.id || "",
      name: fn.name || "",
      ...(custom
        ? { input: extractCustomToolInput(fn.arguments) }
        : { arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments || {}) }),
    });
  }

  const usage = responseBody.usage || {};
  const finishReason = String(choice.finish_reason || "").toLowerCase();
  let status = "completed";
  let incompleteReason = null;
  if (["length", "max_tokens", "max_output_tokens"].includes(finishReason)) {
    status = "incomplete";
    incompleteReason = "max_output_tokens";
  } else if (["content_filter", "safety", "recitation", "blocklist", "prohibited_content", "spii", "refusal"].includes(finishReason)) {
    status = "incomplete";
    incompleteReason = "content_filter";
  }

  return {
    id: `resp_${responseBody.id || ""}`.replace(/^resp_chatcmpl-/, "resp_"),
    object: "response",
    created_at: responseBody.created || Math.floor(Date.now() / 1000),
    model: responseBody.model || "unknown",
    status,
    background: false,
    error: null,
    ...(incompleteReason ? { incomplete_details: { reason: incompleteReason } } : {}),
    output,
    usage: {
      input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
      output_tokens: usage.completion_tokens || usage.output_tokens || 0,
      total_tokens: usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
    },
  };
}

function parseArgs(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function openAICompletionToGemini(responseBody) {
  const choice = responseBody?.choices?.[0];
  if (!choice) return responseBody;

  const message = choice.message || {};
  const parts = [];
  const reasoning = message.reasoning_content || message.reasoning;
  if (typeof reasoning === "string" && reasoning.length > 0) parts.push({ thought: true, text: reasoning });
  if (typeof message.content === "string" && message.content.length > 0) parts.push({ text: message.content });
  for (const tc of message.tool_calls || []) {
    const fn = tc.function || {};
    parts.push({ functionCall: { name: fn.name || "", args: parseArgs(fn.arguments) } });
  }
  if (parts.length === 0) parts.push({ text: "" });

  const usage = responseBody.usage || {};
  const thoughts = usage.completion_tokens_details?.reasoning_tokens || 0;
  const usageMetadata = {
    promptTokenCount: Math.max(0, (usage.prompt_tokens || 0) - thoughts),
    candidatesTokenCount: usage.completion_tokens || 0,
    totalTokenCount: usage.total_tokens || 0,
  };
  if (thoughts > 0) usageMetadata.thoughtsTokenCount = thoughts;
  if (usage.prompt_tokens_details?.cached_tokens) {
    usageMetadata.cachedContentTokenCount = usage.prompt_tokens_details.cached_tokens;
  }

  return {
    response: {
      candidates: [{
        content: { role: GEMINI_ROLE.MODEL, parts },
        finishReason: fromOpenAIFinish(choice.finish_reason || OPENAI_FINISH.STOP, FORMATS.GEMINI),
        index: 0,
      }],
      usageMetadata,
      modelVersion: responseBody.model || "gemini",
      responseId: responseBody.id || `resp_${Date.now()}`,
    },
  };
}
