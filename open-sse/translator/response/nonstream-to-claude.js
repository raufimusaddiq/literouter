import { fromOpenAIFinish } from "../concerns/finishReason.js";
import { FORMATS } from "../formats.js";
import { RESPONSES_ITEM } from "../schema/index.js";

function parseToolArguments(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function buildClaudeMessage({ id, model, content, finishReason, usage }) {
  if (content.length === 0) content.push({ type: "text", text: "" });
  return {
    id: String(id || `msg_${Date.now()}`).replace(/^(chatcmpl|resp)_/, "msg_"),
    type: "message",
    role: "assistant",
    model: model || "unknown",
    content,
    stop_reason: fromOpenAIFinish(finishReason, FORMATS.CLAUDE),
    stop_sequence: null,
    usage: toClaudeUsage(usage),
  };
}

// Claude reports input_tokens EXCLUDING cache, with cache read/write apart.
// OpenAI Chat (prompt_tokens + prompt_tokens_details) and Responses (input_tokens
// + input_tokens_details) report a cache-inclusive prompt, so split it the same
// way the streaming openai-to-claude translator does (#130). Claude-shaped usage
// (input_tokens + cache_*_input_tokens) is already split and passes through.
function toClaudeUsage(usage) {
  const n = (v) => (typeof v === "number" ? v : 0);
  const output = n(usage?.completion_tokens) || n(usage?.output_tokens);
  let input, cacheRead, cacheCreation;
  if (usage?.prompt_tokens !== undefined) {
    cacheRead = n(usage.prompt_tokens_details?.cached_tokens);
    cacheCreation = n(usage.prompt_tokens_details?.cache_creation_tokens);
    input = Math.max(0, n(usage.prompt_tokens) - cacheRead - cacheCreation);
  } else if (usage?.input_tokens_details) {
    cacheRead = n(usage.input_tokens_details.cached_tokens);
    cacheCreation = 0;
    input = Math.max(0, n(usage.input_tokens) - cacheRead);
  } else {
    cacheRead = n(usage?.cache_read_input_tokens);
    cacheCreation = n(usage?.cache_creation_input_tokens);
    input = n(usage?.input_tokens);
  }
  const out = { input_tokens: input, output_tokens: output };
  if (cacheRead > 0) out.cache_read_input_tokens = cacheRead;
  if (cacheCreation > 0) out.cache_creation_input_tokens = cacheCreation;
  return out;
}

export function openAICompletionToClaudeMessage(responseBody) {
  if (!responseBody?.choices?.[0]) return responseBody;
  const choice = responseBody.choices[0];
  const message = choice.message || {};
  const content = [];
  const reasoning = message.reasoning_content || message.provider_specific_fields?.reasoning_content || "";

  if (reasoning) content.push({ type: "thinking", thinking: reasoning });
  if (typeof message.content === "string" && message.content.length > 0) content.push({ type: "text", text: message.content });
  for (const toolCall of message.tool_calls || []) {
    const fn = toolCall.function || {};
    content.push({
      type: "tool_use",
      id: toolCall.id || `toolu_${Date.now()}_${content.length}`,
      name: fn.name || toolCall.name || "",
      input: parseToolArguments(fn.arguments || toolCall.arguments),
    });
  }

  return buildClaudeMessage({
    id: responseBody.id,
    model: responseBody.model,
    content,
    finishReason: choice.finish_reason,
    usage: responseBody.usage,
  });
}

export function responsesToClaudeMessage(responseBody) {
  if (!Array.isArray(responseBody?.output)) return responseBody;
  const content = [];
  let hasToolCalls = false;

  for (const item of responseBody.output) {
    if (item?.type === RESPONSES_ITEM.REASONING) {
      const thinking = (item.summary || []).map(part => part?.text || "").join("");
      if (thinking) content.push({ type: "thinking", thinking });
    } else if (item?.type === RESPONSES_ITEM.MESSAGE) {
      for (const part of item.content || []) {
        if (part?.type === RESPONSES_ITEM.OUTPUT_TEXT && typeof part.text === "string") content.push({ type: "text", text: part.text });
      }
    } else if (item?.type === RESPONSES_ITEM.FUNCTION_CALL || item?.type === RESPONSES_ITEM.CUSTOM_TOOL_CALL) {
      hasToolCalls = true;
      content.push({
        type: "tool_use",
        id: item.call_id || item.id || `toolu_${Date.now()}_${content.length}`,
        name: item.name || "",
        input: item.type === RESPONSES_ITEM.CUSTOM_TOOL_CALL ? { input: item.input || "" } : parseToolArguments(item.arguments),
      });
    }
  }

  return buildClaudeMessage({
    id: responseBody.id,
    model: responseBody.model,
    content,
    finishReason: hasToolCalls ? "tool_calls" : (responseBody.status === "incomplete" ? "length" : "stop"),
    usage: responseBody.usage,
  });
}
