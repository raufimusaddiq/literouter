import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { GEMINI_ROLE } from "../schema/index.js";
import { fromOpenAIFinish } from "../concerns/finishReason.js";
import { extractReasoningText } from "../concerns/reasoning.js";
import { safeParseJSON } from "../concerns/json.js";


function buildUsageMetadata(usage) {
  if (!usage) return null;
  const meta = {
    promptTokenCount: usage.prompt_tokens || 0,
    candidatesTokenCount: usage.completion_tokens || 0,
    totalTokenCount: usage.total_tokens || 0
  };
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens;
  if (reasoningTokens) meta.thoughtsTokenCount = reasoningTokens;
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens;
  if (cachedTokens) meta.cachedContentTokenCount = cachedTokens;
  return meta;
}

function functionCallPart(call, state) {
  const name = state?.toolNameMap?.get(call.name) || call.name;
  const part = { functionCall: { name, args: safeParseJSON(call.arguments, {}) || {} } };
  if (call.id) part.functionCall.id = call.id;
  return part;
}

export function openaiToGeminiResponse(chunk, state) {
  if (!chunk || typeof chunk !== "object") return null;
  if (!state._toolCallAccum) state._toolCallAccum = {};
  if (!state._responseId && chunk.id) state._responseId = chunk.id;
  if (!state._modelVersion && chunk.model) state._modelVersion = chunk.model;

  const choice = chunk.choices?.[0];
  if (!choice) {
    const meta = buildUsageMetadata(chunk.usage);
    if (!meta) return null;
    if (!state._finishEmitted) {
      state._usageMetadata = meta;
      return null;
    }
    return {
      usageMetadata: meta,
      modelVersion: state._modelVersion
    };
  }

  const delta = choice.delta || {};
  const parts = [];

  const reasoning = extractReasoningText(delta);
  if (reasoning) parts.push({ thought: true, text: reasoning });
  if (delta.content) parts.push({ text: delta.content });

  for (const tc of delta.tool_calls || []) {
    const idx = tc.index ?? 0;
    const accum = state._toolCallAccum[idx] ||= { id: "", name: "", arguments: "" };
    if (tc.id) accum.id = tc.id;
    if (tc.function?.name) accum.name += tc.function.name;
    if (tc.function?.arguments) accum.arguments += tc.function.arguments;
  }

  const finish = choice.finish_reason;
  if (finish) {
    for (const idx of Object.keys(state._toolCallAccum).sort((a, b) => a - b)) {
      parts.push(functionCallPart(state._toolCallAccum[idx], state));
    }
    state._toolCallAccum = {};
  }

  if (parts.length === 0 && !finish) return null;

  const candidate = {
    content: { role: GEMINI_ROLE.MODEL, parts: parts.length > 0 ? parts : [{ text: "" }] },
    index: 0
  };
  const result = { candidates: [candidate], modelVersion: state._modelVersion };

  if (finish) {
    candidate.finishReason = fromOpenAIFinish(finish, FORMATS.GEMINI);
    state._finishEmitted = true;
    const meta = buildUsageMetadata(chunk.usage) || state._usageMetadata;
    if (meta) result.usageMetadata = meta;
  }
  return result;
}

export function openaiCompletionToGemini(body, model, toolNameMap = null) {
  const candidates = (body.choices || []).map((choice, i) => {
    const message = choice.message || {};
    const parts = [];
    const reasoning = extractReasoningText(message);
    if (reasoning) parts.push({ thought: true, text: reasoning });
    if (message.content) parts.push({ text: message.content });
    for (const tc of message.tool_calls || []) {
      parts.push(functionCallPart(
        { id: tc.id, name: tc.function?.name, arguments: tc.function?.arguments },
        { toolNameMap }
      ));
    }
    if (parts.length === 0) parts.push({ text: "" });
    return {
      content: { role: GEMINI_ROLE.MODEL, parts },
      finishReason: fromOpenAIFinish(choice.finish_reason, FORMATS.GEMINI),
      index: choice.index ?? i
    };
  });

  const result = { candidates, modelVersion: body.model || model };
  if (body.id) result.responseId = body.id;
  const meta = buildUsageMetadata(body.usage);
  if (meta) result.usageMetadata = meta;
  return result;
}

register(FORMATS.OPENAI, FORMATS.GEMINI, null, openaiToGeminiResponse);
