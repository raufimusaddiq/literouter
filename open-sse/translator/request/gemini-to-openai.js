import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { adjustMaxTokens } from "../formats/maxTokens.js";
import { encodeDataUri } from "../concerns/image.js";
import { collapseTextParts } from "../concerns/message.js";
import { ROLE, GEMINI_ROLE, OPENAI_BLOCK } from "../schema/index.js";
import { toOpenAIStop } from "../concerns/requestParams.js";

const GEMINI_MODE_AUTO = "AUTO";
const GEMINI_MODE_NONE = "NONE";
const GEMINI_MODE_ANY = "ANY";
const JSON_MIME_TYPE = "application/json";

function lowerCaseSchemaTypes(schema) {
  if (Array.isArray(schema)) return schema.map(lowerCaseSchemaTypes);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    out[key] = key === "type" && typeof value === "string" ? value.toLowerCase() : lowerCaseSchemaTypes(value);
  }
  return out;
}

function geminiToolConfigToChoice(toolConfig) {
  const cfg = toolConfig?.functionCallingConfig;
  if (!cfg?.mode) return undefined;
  switch (String(cfg.mode).toUpperCase()) {
    case GEMINI_MODE_NONE: return "none";
    case GEMINI_MODE_AUTO: return "auto";
    case GEMINI_MODE_ANY: {
      const names = cfg.allowedFunctionNames;
      if (Array.isArray(names) && names.length === 1) {
        return { type: OPENAI_BLOCK.FUNCTION, function: { name: names[0] } };
      }
      return "required";
    }
    default: return undefined;
  }
}

function createCallIdTracker() {
  const counts = new Map();
  const pending = new Map();
  return {
    next(call) {
      if (call.id) return call.id;
      const n = counts.get(call.name) || 0;
      counts.set(call.name, n + 1);
      const id = n === 0 ? `call_${call.name}` : `call_${call.name}_${n}`;
      if (!pending.has(call.name)) pending.set(call.name, []);
      pending.get(call.name).push(id);
      return id;
    },
    match(response) {
      if (response.id) return response.id;
      return pending.get(response.name)?.shift() || `call_${response.name}`;
    }
  };
}

export function geminiToOpenAIRequest(model, body, stream) {
  const result = {
    model: model,
    messages: [],
    stream: stream
  };

  if (body.generationConfig) {
    const config = body.generationConfig;
    if (config.maxOutputTokens) {
      const tempBody = { max_tokens: config.maxOutputTokens, tools: body.tools };
      result.max_tokens = adjustMaxTokens(tempBody);
    }
    if (config.temperature !== undefined) {
      result.temperature = config.temperature;
    }
    if (config.topP !== undefined) {
      result.top_p = config.topP;
    }
    if (config.topK !== undefined) {
      result.top_k = config.topK;
    }
    const stop = toOpenAIStop(config.stopSequences);
    if (stop !== undefined) {
      result.stop = stop;
    }
    if (Number.isFinite(config.candidateCount) && config.candidateCount > 1) {
      result.n = config.candidateCount;
    }
    const schema = config.responseJsonSchema || config.responseSchema;
    if (schema && typeof schema === "object") {
      result.response_format = {
        type: "json_schema",
        json_schema: { name: "response", schema: lowerCaseSchemaTypes(schema) }
      };
    } else if (config.responseMimeType === JSON_MIME_TYPE) {
      result.response_format = { type: "json_object" };
    }
  }

  if (body.systemInstruction) {
    const systemText = extractGeminiText(body.systemInstruction);
    if (systemText) {
      result.messages.push({
        role: ROLE.SYSTEM,
        content: systemText
      });
    }
  }

  if (body.contents && Array.isArray(body.contents)) {
    const callIds = createCallIdTracker();
    for (const content of body.contents) {
      const converted = convertGeminiContent(content, callIds);
      if (converted) {
        if (Array.isArray(converted)) result.messages.push(...converted);
        else result.messages.push(converted);
      }
    }
  }

  if (body.tools && Array.isArray(body.tools)) {
    result.tools = [];
    for (const tool of body.tools) {
      if (tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          result.tools.push({
            type: OPENAI_BLOCK.FUNCTION,
            function: {
              name: func.name,
              description: func.description || "",
              parameters: func.parametersJsonSchema || (func.parameters ? lowerCaseSchemaTypes(func.parameters) : { type: "object", properties: {} })
            }
          });
        }
      }
    }
  }

  if (result.tools?.length === 0) {
    delete result.tools;
  } else if (result.tools) {
    const choice = geminiToolConfigToChoice(body.toolConfig);
    if (choice !== undefined) result.tool_choice = choice;
  }

  return result;
}

function convertGeminiContent(content, callIds) {
  const role = content.role === GEMINI_ROLE.USER ? ROLE.USER : ROLE.ASSISTANT;
  
  if (!content.parts || !Array.isArray(content.parts)) {
    return null;
  }

  const parts = [];
  const toolCalls = [];
  const toolResults = [];

  for (const part of content.parts) {
    if (part.thought === true) continue;

    if (part.text !== undefined) {
      parts.push({ type: OPENAI_BLOCK.TEXT, text: part.text });
    }

    if (part.inlineData) {
      parts.push({
        type: OPENAI_BLOCK.IMAGE_URL,
        image_url: {
          url: encodeDataUri(part.inlineData.mimeType, part.inlineData.data)
        }
      });
    }

    if (part.functionCall) {
      toolCalls.push({
        id: callIds.next(part.functionCall),
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {})
        }
      });
    }

    if (part.functionResponse) {
      toolResults.push({
        role: ROLE.TOOL,
        tool_call_id: callIds.match(part.functionResponse),
        content: JSON.stringify(part.functionResponse.response?.result || part.functionResponse.response || {})
      });
    }
  }

  let message = null;
  if (toolCalls.length > 0) {
    message = { role: ROLE.ASSISTANT };
    if (parts.length > 0) {
      message.content = parts.length === 1 ? parts[0].text : parts;
    }
    message.tool_calls = toolCalls;
  } else if (parts.length > 0) {
    message = {
      role,
      content: collapseTextParts(parts)
    };
  }

  if (toolResults.length > 0) {
    return message ? [...toolResults, message] : toolResults;
  }
  return message;
}

function extractGeminiText(content) {
  if (typeof content === "string") return content;
  if (content.parts && Array.isArray(content.parts)) {
    return content.parts.map(p => p.text || "").join("");
  }
  return "";
}

register(FORMATS.GEMINI, FORMATS.OPENAI, geminiToOpenAIRequest, null);
register(FORMATS.GEMINI_CLI, FORMATS.OPENAI, geminiToOpenAIRequest, null);

