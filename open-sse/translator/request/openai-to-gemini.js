import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { DEFAULT_THINKING_AG_SIGNATURE, DEFAULT_THINKING_GEMINI_CLI_SIGNATURE } from "../../config/defaultThinkingSignature.js";
import { openaiToClaudeRequestForAntigravity } from "./openai-to-claude.js";
import { getGeminiThoughtSignatureSync } from "../../services/thoughtSignatureStore.js";
function generateUUID() {
  return crypto.randomUUID();
}

import {
  DEFAULT_SAFETY_SETTINGS,
  convertOpenAIContentToParts,
  extractTextContent,
  tryParseJSON,
  generateRequestId,
  generateSessionId,
  generateProjectId,
  cleanJSONSchemaForAntigravity,
  normalizeGeminiContents
} from "../formats/gemini.js";
import { deriveSessionId, toNumericSessionId } from "../../utils/sessionManager.js";
import { ROLE, GEMINI_ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from "../schema/index.js";
import { isGemini4Model } from "../../providers/capabilities.js";
import { resolveMaxTokens, normalizeStopSequences, STOP_SEQUENCE_LIMITS } from "../concerns/requestParams.js";

const GEMINI_FUNCTION_CALLING_MODE = { AUTO: "AUTO", NONE: "NONE", ANY: "ANY" };

export function openAIToolChoiceToGeminiConfig(choice) {
  if (!choice) return undefined;
  if (typeof choice === "string") {
    if (choice === "none") return { functionCallingConfig: { mode: GEMINI_FUNCTION_CALLING_MODE.NONE } };
    if (choice === "required") return { functionCallingConfig: { mode: GEMINI_FUNCTION_CALLING_MODE.ANY } };
    if (choice === "auto") return { functionCallingConfig: { mode: GEMINI_FUNCTION_CALLING_MODE.AUTO } };
    return undefined;
  }
  const name = choice.function?.name ?? (choice.type === "tool" ? choice.name : undefined);
  if (name) {
    return {
      functionCallingConfig: {
        mode: GEMINI_FUNCTION_CALLING_MODE.ANY,
        allowedFunctionNames: [sanitizeGeminiFunctionName(name)]
      }
    };
  }
  if (choice.type === "any") return { functionCallingConfig: { mode: GEMINI_FUNCTION_CALLING_MODE.ANY } };
  if (choice.type === "none") return { functionCallingConfig: { mode: GEMINI_FUNCTION_CALLING_MODE.NONE } };
  if (choice.type === "auto") return { functionCallingConfig: { mode: GEMINI_FUNCTION_CALLING_MODE.AUTO } };
  return undefined;
}

function explicitToolConfig(toolConfig) {
  return toolConfig?.functionCallingConfig?.mode === GEMINI_FUNCTION_CALLING_MODE.AUTO ? undefined : toolConfig;
}

const JSON_MIME_TYPE = "application/json";

function applyResponseFormat(generationConfig, responseFormat) {
  if (!responseFormat) return;
  if (responseFormat.type === "json_object") {
    generationConfig.responseMimeType = JSON_MIME_TYPE;
  } else if (responseFormat.type === "json_schema") {
    generationConfig.responseMimeType = JSON_MIME_TYPE;
    const schema = responseFormat.json_schema?.schema;
    if (schema && typeof schema === "object") {
      generationConfig.responseSchema = cleanJSONSchemaForAntigravity(structuredClone(schema));
    }
  }
}

function sanitizeGeminiFunctionName(name) {
  if (!name) return "_unknown";
  let sanitized = name.replace(/[^a-zA-Z0-9_.:\-]/g, "_");
  if (!/^[a-zA-Z_]/.test(sanitized)) {
    sanitized = "_" + sanitized;
  }
  return sanitized.substring(0, 64);
}

function createToolCallIdUniquifier() {
  const used = new Set();
  return {
    next(id) {
      if (!id) return id;
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
      let n = 2;
      let candidate = `${id}-${n}`;
      while (used.has(candidate)) candidate = `${id}-${n++}`;
      used.add(candidate);
      return candidate;
    },
  };
}

function openaiToGeminiBase(model, body, stream, signature = DEFAULT_THINKING_AG_SIGNATURE, sessionId = null) {
  const result = {
    model: model,
    contents: [],
    generationConfig: {},
    safetySettings: DEFAULT_SAFETY_SETTINGS
  };

  const allowSampling = !isGemini4Model(model);
  if (allowSampling && body.temperature !== undefined) {
    result.generationConfig.temperature = body.temperature;
  }
  if (allowSampling && body.top_p !== undefined) {
    result.generationConfig.topP = body.top_p;
  }
  if (allowSampling && body.top_k !== undefined) {
    result.generationConfig.topK = body.top_k;
  }
  const maxTokens = resolveMaxTokens(body);
  if (maxTokens !== undefined) {
    result.generationConfig.maxOutputTokens = maxTokens;
  }
  const stopSequences = normalizeStopSequences(body.stop ?? body.stop_sequences, STOP_SEQUENCE_LIMITS.gemini, "Gemini");
  if (stopSequences) {
    result.generationConfig.stopSequences = stopSequences;
  }
  applyResponseFormat(result.generationConfig, body.response_format);

  const tcID2Name = {};
  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.type === OPENAI_BLOCK.FUNCTION && tc.id && tc.function?.name) {
            tcID2Name[tc.id] = tc.function.name;
          }
        }
      }
    }
  }

  const toolResponses = {};
  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.role === ROLE.TOOL && msg.tool_call_id) {
        (toolResponses[msg.tool_call_id] ||= []).push(msg.content);
      }
    }
  }
  const toolResponseCursor = {};

  const toolCallIdUniquifier = createToolCallIdUniquifier();

  if (body.messages && Array.isArray(body.messages)) {
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];
      const role = msg.role;
      const content = msg.content;

      if (role === ROLE.SYSTEM && body.messages.length > 1) {
        result.systemInstruction = {
          role: GEMINI_ROLE.USER,
          parts: [{ text: typeof content === "string" ? content : extractTextContent(content) }]
        };
      } else if (role === ROLE.USER || (role === ROLE.SYSTEM && body.messages.length === 1)) {
        const parts = convertOpenAIContentToParts(content);
        if (parts.length > 0) {
          result.contents.push({ role: GEMINI_ROLE.USER, parts });
        }
      } else if (role === ROLE.ASSISTANT) {
        const parts = [];

        if (msg.reasoning_content) {
          parts.push({
            thought: true,
            text: msg.reasoning_content
          });
          parts.push({
            thoughtSignature: signature,
            text: ""
          });
        }

        if (content) {
          const text = typeof content === "string" ? content : extractTextContent(content);
          if (text) {
            parts.push({ text });
          }
        }

        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          const toolCallIds = [];
          let firstFunctionCallSeen = false;
          for (const tc of msg.tool_calls) {
            if (tc.type !== OPENAI_BLOCK.FUNCTION) continue;

            const args = tryParseJSON(tc.function?.arguments || "{}");
            const cachedSig = tc.id ? getGeminiThoughtSignatureSync(tc.id, sessionId, model) : null;
            const callSig = cachedSig || (!firstFunctionCallSeen ? signature : undefined);
            firstFunctionCallSeen = true;

            const emitId = toolCallIdUniquifier.next(tc.id);

            const part = {
              functionCall: {
                id: emitId,
                name: sanitizeGeminiFunctionName(tc.function.name),
                args: args
              }
            };
            if (callSig) {
              part.thoughtSignature = callSig;
            }
            parts.push(part);
            toolCallIds.push({ origId: tc.id, emitId, name: tc.function?.name });
          }

          if (parts.length > 0) {
            result.contents.push({ role: GEMINI_ROLE.MODEL, parts });
          }

          const isIntermediate = i < body.messages.length - 1;
          const hasActualResponses = toolCallIds.some(
            ({ origId }) => (toolResponseCursor[origId] || 0) < (toolResponses[origId]?.length ?? 0)
          );

          if (hasActualResponses || isIntermediate) {
            const toolParts = [];
            for (const { origId, emitId, name: callName } of toolCallIds) {
              const queue = toolResponses[origId];
              const cursor = toolResponseCursor[origId] || 0;
              let resp;
              if (queue && cursor < queue.length) {
                resp = queue[cursor];
                toolResponseCursor[origId] = cursor + 1;
              } else {
                resp = "";
              }

              let name = callName || tcID2Name[origId];
              if (!name) {
                const idParts = String(origId).split("-");
                if (idParts.length > 2) {
                  name = idParts.slice(0, -2).join("-");
                } else {
                  name = origId;
                }
              }

              let parsedResp = tryParseJSON(resp);
              if (parsedResp === null) {
                parsedResp = { result: resp };
              } else if (typeof parsedResp !== "object") {
                parsedResp = { result: parsedResp };
              }

              toolParts.push({
                functionResponse: {
                  id: emitId,
                  name: sanitizeGeminiFunctionName(name),
                  response: { result: parsedResp }
                }
              });
            }
            if (toolParts.length > 0) {
              result.contents.push({ role: GEMINI_ROLE.USER, parts: toolParts });
            }
          }
        } else if (parts.length > 0) {
          result.contents.push({ role: GEMINI_ROLE.MODEL, parts });
        }
      }
    }
  }

  if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    const functionDeclarations = [];
    for (const t of body.tools) {
      if (t.name && t.input_schema) {
        const cleanedSchema = cleanJSONSchemaForAntigravity(structuredClone(t.input_schema || { type: "object", properties: {} }));
        functionDeclarations.push({
          name: sanitizeGeminiFunctionName(t.name),
          description: t.description || "",
          parameters: cleanedSchema
        });
      }
      else if (t.type === OPENAI_BLOCK.FUNCTION && t.function) {
        const fn = t.function;
        const cleanedSchema = cleanJSONSchemaForAntigravity(structuredClone(fn.parameters || { type: "object", properties: {} }));
        functionDeclarations.push({
          name: sanitizeGeminiFunctionName(fn.name),
          description: fn.description || "",
          parameters: cleanedSchema
        });
      }
    }

    if (functionDeclarations.length > 0) {
      result.tools = [{ functionDeclarations }];
      const toolConfig = openAIToolChoiceToGeminiConfig(body.tool_choice);
      if (toolConfig) result.toolConfig = toolConfig;
    }
  }

  result.contents = normalizeGeminiContents(result.contents, model);
  return result;
}

export function openaiToGeminiRequest(model, body, stream, credentials = null) {
  return openaiToGeminiBase(model, body, stream, DEFAULT_THINKING_AG_SIGNATURE, credentials?._clientSessionId);
}

export function openaiToGeminiCLIRequest(model, body, stream, credentials = null) {
  const gemini = openaiToGeminiBase(model, body, stream, DEFAULT_THINKING_GEMINI_CLI_SIGNATURE, credentials?._clientSessionId);

  if (gemini.tools?.[0]?.functionDeclarations) {
    for (const fn of gemini.tools[0].functionDeclarations) {
      if (fn.parameters) {
        const cleanedSchema = cleanJSONSchemaForAntigravity(fn.parameters);
        fn.parameters = cleanedSchema;
      }
    }
  }

  return gemini;
}

function wrapInCloudCodeEnvelope(model, geminiCLI, credentials = null, isAntigravity = false) {
  const projectId = credentials?.projectId || generateProjectId();

  const envelope = {
    project: projectId,
    model: model,
    userAgent: isAntigravity ? "antigravity" : "gemini-cli",
    requestId: isAntigravity ? `agent-${generateUUID()}` : generateRequestId(),
    request: {
      sessionId: toNumericSessionId(credentials?._clientSessionId) || (isAntigravity ? deriveSessionId(credentials?.email || credentials?.connectionId) : generateSessionId()),
      contents: geminiCLI.contents,
      systemInstruction: geminiCLI.systemInstruction,
      generationConfig: geminiCLI.generationConfig,
      tools: geminiCLI.tools,
    }
  };

  if (!isAntigravity) {
    envelope.request.safetySettings = geminiCLI.safetySettings;
  }

  const explicitConfig = explicitToolConfig(geminiCLI.toolConfig);
  if (explicitConfig) {
    envelope.request.toolConfig = explicitConfig;
  } else if (geminiCLI.tools?.length > 0) {
    envelope.request.toolConfig = {
      functionCallingConfig: { mode: "VALIDATED" }
    };
  }

  return envelope;
}

function wrapInCloudCodeEnvelopeForClaude(model, claudeRequest, credentials = null, signature = DEFAULT_THINKING_AG_SIGNATURE) {
  const projectId = credentials?.projectId || generateProjectId();

  const envelope = {
    project: projectId,
    model: model,
    userAgent: "antigravity",
    requestId: `agent-${generateUUID()}`,
    request: {
      sessionId: toNumericSessionId(credentials?._clientSessionId) || deriveSessionId(credentials?.email || credentials?.connectionId),
      contents: [],
      generationConfig: {
        temperature: claudeRequest.temperature || 1,
        maxOutputTokens: claudeRequest.max_tokens || 4096
      }
    }
  };

  if (claudeRequest.top_p !== undefined) envelope.request.generationConfig.topP = claudeRequest.top_p;
  if (Array.isArray(claudeRequest.stop_sequences) && claudeRequest.stop_sequences.length > 0) {
    envelope.request.generationConfig.stopSequences = normalizeStopSequences(claudeRequest.stop_sequences, STOP_SEQUENCE_LIMITS.gemini, "Gemini");
  }

  const toolUseIdToName = {};
  if (claudeRequest.messages && Array.isArray(claudeRequest.messages)) {
    for (const msg of claudeRequest.messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === CLAUDE_BLOCK.TOOL_USE && block.id && block.name) {
            toolUseIdToName[block.id] = block.name;
          }
        }
      }
    }
  }

  if (claudeRequest.messages && Array.isArray(claudeRequest.messages)) {
    for (const msg of claudeRequest.messages) {
      const parts = [];

      if (Array.isArray(msg.content)) {
        let firstToolUseSeen = false;
        for (const block of msg.content) {
          if (block.type === CLAUDE_BLOCK.TEXT) {
            parts.push({ text: block.text });
          } else if (block.type === CLAUDE_BLOCK.TOOL_USE) {
            const cachedSig = block.id ? getGeminiThoughtSignatureSync(block.id, credentials?._clientSessionId, model) : null;
            const callSig = cachedSig || (!firstToolUseSeen ? signature : undefined);
            firstToolUseSeen = true;

            const part = {
              functionCall: {
                id: block.id,
                name: sanitizeGeminiFunctionName(block.name),
                args: block.input || {}
              }
            };
            if (callSig) {
              part.thoughtSignature = callSig;
            }
            parts.push(part);
          } else if (block.type === CLAUDE_BLOCK.TOOL_RESULT) {
            let content = block.content;
            if (Array.isArray(content)) {
              content = content.map(c => c.type === CLAUDE_BLOCK.TEXT ? c.text : JSON.stringify(c)).join("\n");
            }
            const resolvedName = toolUseIdToName[block.tool_use_id]
              ? sanitizeGeminiFunctionName(toolUseIdToName[block.tool_use_id])
              : "tool";
            parts.push({
              functionResponse: {
                id: block.tool_use_id,
                name: resolvedName,
                response: { result: tryParseJSON(content) || content }
              }
            });
          }
        }
      } else if (typeof msg.content === "string") {
        parts.push({ text: msg.content });
      }

      if (parts.length > 0) {
        envelope.request.contents.push({
          role: msg.role === ROLE.ASSISTANT ? GEMINI_ROLE.MODEL : GEMINI_ROLE.USER,
          parts
        });
      }
    }
  }

  if (claudeRequest.tools && Array.isArray(claudeRequest.tools)) {
    const functionDeclarations = [];
    for (const tool of claudeRequest.tools) {
      if (tool.name && tool.input_schema) {
        const cleanedSchema = cleanJSONSchemaForAntigravity(tool.input_schema);
        functionDeclarations.push({
          name: sanitizeGeminiFunctionName(tool.name),
          description: tool.description || "",
          parameters: cleanedSchema
        });
      }
    }
    if (functionDeclarations.length > 0) {
      envelope.request.tools = [{ functionDeclarations }];
      envelope.request.toolConfig = explicitToolConfig(openAIToolChoiceToGeminiConfig(claudeRequest.tool_choice)) || {
        functionCallingConfig: { mode: "VALIDATED" }
      };
    }
  }

  const systemParts = [];
  if (claudeRequest.system) {
    if (Array.isArray(claudeRequest.system)) {
      for (const block of claudeRequest.system) {
        if (block.text) systemParts.push({ text: block.text });
      }
    } else if (typeof claudeRequest.system === "string") {
      systemParts.push({ text: claudeRequest.system });
    }
  }

  if (systemParts.length > 0) {
    envelope.request.systemInstruction = { role: GEMINI_ROLE.USER, parts: systemParts };
  }

  envelope.request.contents = normalizeGeminiContents(envelope.request.contents, model);
  return envelope;
}

function isClaudeModel(model) {
  return model.toLowerCase().includes("claude");
}

export function openaiToAntigravityRequest(model, body, stream, credentials = null) {
  if (isClaudeModel(model)) {
    const claudeRequest = openaiToClaudeRequestForAntigravity(model, body, stream);
    return wrapInCloudCodeEnvelopeForClaude(model, claudeRequest, credentials);
  }

  const geminiCLI = openaiToGeminiCLIRequest(model, body, stream);
  return wrapInCloudCodeEnvelope(model, geminiCLI, credentials, true);
}

register(FORMATS.OPENAI, FORMATS.GEMINI, openaiToGeminiRequest, null);
register(FORMATS.OPENAI, FORMATS.GEMINI_CLI, (model, body, stream, credentials) => wrapInCloudCodeEnvelope(model, openaiToGeminiCLIRequest(model, body, stream), credentials), null);
register(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, openaiToAntigravityRequest, null);
