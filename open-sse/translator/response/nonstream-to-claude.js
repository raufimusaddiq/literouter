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
    usage: {
      input_tokens: usage?.prompt_tokens || usage?.input_tokens || 0,
      output_tokens: usage?.completion_tokens || usage?.output_tokens || 0,
    },
  };
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
