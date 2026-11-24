import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { CLAUDE_SYSTEM_PROMPT } from "../../config/appConstants.js";
import { adjustMaxTokens } from "../formats/maxTokens.js";
import { safeParseJSON } from "../concerns/json.js";
import { parseDataUri } from "../concerns/image.js";
import { PLACEHOLDER_CURRENT } from "../concerns/modality.js";
import { stripAnthropicBillingHeader } from "../concerns/message.js";
import { extractTextContent } from "../formats/gemini.js";
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from "../schema/index.js";
import { getCapabilitiesForModel } from "../../providers/capabilities.js";
import { createToolNameSanitizer, collectChatToolNames } from "../concerns/toolNames.js";
import { normalizeStopSequences, STOP_SEQUENCE_LIMITS } from "../concerns/requestParams.js";

const CLAUDE_OAUTH_TOOL_PREFIX = "";

export function openaiToClaudeRequest(model, body, stream, credentials, provider = null) {
  const toolNameMap = new Map();
  const toolNames = createToolNameSanitizer(collectChatToolNames(body));
  const modelCeiling = getCapabilitiesForModel(null, model).maxOutput || undefined;
  const result = {
    model: model,
    max_tokens: adjustMaxTokens(body, modelCeiling),
    stream: stream
  };

  if (body.temperature !== undefined) {
    result.temperature = body.temperature;
  }
  if (body.top_p !== undefined) {
    result.top_p = body.top_p;
  }
  if (body.top_k !== undefined) {
    result.top_k = body.top_k;
  }
  const stopSequences = normalizeStopSequences(body.stop ?? body.stop_sequences, STOP_SEQUENCE_LIMITS.claude, "Claude");
  if (stopSequences) {
    result.stop_sequences = stopSequences;
  }

  result.messages = [];
  const systemParts = [];

  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.role === ROLE.SYSTEM) {
        const textParts = Array.isArray(msg.content)
          ? msg.content.filter(part => part.type === OPENAI_BLOCK.TEXT).map(part => part.text)
          : [msg.content];
        systemParts.push(...textParts.map(stripAnthropicBillingHeader).filter(Boolean));
      }
    }

    const nonSystemMessages = body.messages.filter(m => m.role !== ROLE.SYSTEM);

    let currentRole = undefined;
    let currentParts = [];

    const flushCurrentMessage = () => {
      if (currentRole && currentParts.length > 0) {
        result.messages.push({ role: currentRole, content: currentParts });
        currentParts = [];
      }
    };

    for (const msg of nonSystemMessages) {
      const newRole = (msg.role === ROLE.USER || msg.role === ROLE.TOOL) ? ROLE.USER : ROLE.ASSISTANT;
      const blocks = getContentBlocksFromMessage(msg, toolNameMap, toolNames.safe);
      const hasToolUse = blocks.some(b => b.type === CLAUDE_BLOCK.TOOL_USE);
      const hasToolResult = blocks.some(b => b.type === CLAUDE_BLOCK.TOOL_RESULT);

      if (hasToolResult) {
        const toolResultBlocks = blocks.filter(b => b.type === CLAUDE_BLOCK.TOOL_RESULT);
        const otherBlocks = blocks.filter(b => b.type !== CLAUDE_BLOCK.TOOL_RESULT);

        flushCurrentMessage();

        if (toolResultBlocks.length > 0) {
          result.messages.push({ role: ROLE.USER, content: toolResultBlocks });
        }

        if (otherBlocks.length > 0) {
          currentRole = newRole;
          currentParts.push(...otherBlocks);
        }
        continue;
      }

      if (currentRole !== newRole) {
        flushCurrentMessage();
        currentRole = newRole;
      }

      currentParts.push(...blocks);

      if (hasToolUse) {
        flushCurrentMessage();
      }
    }

    flushCurrentMessage();

    for (let i = result.messages.length - 1; i >= 0; i--) {
      const message = result.messages[i];
      if (message.role === ROLE.ASSISTANT && Array.isArray(message.content) && message.content.length > 0) {
        const validBlockTypes = [CLAUDE_BLOCK.TEXT, CLAUDE_BLOCK.TOOL_USE, CLAUDE_BLOCK.TOOL_RESULT, CLAUDE_BLOCK.IMAGE];
        for (let j = message.content.length - 1; j >= 0; j--) {
          const block = message.content[j];
          if (validBlockTypes.includes(block.type)) {
            block.cache_control = { type: "ephemeral" };
            break;
          }
        }
        break;
      }
    }
  }

  if (body.response_format) {
    const responseFormat = body.response_format;
    if (responseFormat.type === "json_schema" && responseFormat.json_schema?.schema) {
      const schemaJson = JSON.stringify(responseFormat.json_schema.schema, null, 2);
      systemParts.push(`You must respond with valid JSON that strictly follows this JSON schema:
\`\`\`json
${schemaJson}
\`\`\`
Respond ONLY with the JSON object, no other text.`);
    } else if (responseFormat.type === "json_object") {
      systemParts.push("You must respond with valid JSON. Respond ONLY with a JSON object, no other text.");
    }
  }

  const claudeCodePrompt = provider === "claude" ? [{ type: CLAUDE_BLOCK.TEXT, text: CLAUDE_SYSTEM_PROMPT }] : [];

  if (systemParts.length > 0) {
    const systemText = systemParts.join("\n");
    result.system = [
      ...claudeCodePrompt,
      { type: CLAUDE_BLOCK.TEXT, text: systemText, cache_control: { type: "ephemeral", ttl: "1h" } }
    ];
  } else if (claudeCodePrompt.length > 0) {
    result.system = claudeCodePrompt;
  }

  if (body.tools && Array.isArray(body.tools)) {
    result.tools = [];
    for (const tool of body.tools) {
      const toolType = tool.type;
      if (toolType && toolType !== OPENAI_BLOCK.FUNCTION) {
        result.tools.push(tool);
        continue;
      }

      const toolData = tool.function ?? tool;
      const originalName = toolData.name;

      const toolName = CLAUDE_OAUTH_TOOL_PREFIX + (typeof originalName === "string" ? toolNames.safe(originalName.trim()) : originalName);

      toolNameMap.set(toolName, originalName);

      result.tools.push({
        name: toolName,
        description: toolData.description || "",
        input_schema: toolData.parameters || toolData.input_schema || { type: "object", properties: {}, required: [] }
      });
    }

    if (result.tools.length > 0) {
      result.tools[result.tools.length - 1].cache_control = { type: "ephemeral", ttl: "1h" };
    }
  }

  if (body.tool_choice) {
    result.tool_choice = convertOpenAIToolChoice(body.tool_choice, toolNames.safe);
  }

  if (body.parallel_tool_calls === false && result.tools?.length > 0) {
    const choice = result.tool_choice || { type: "auto" };
    if (choice.type !== "none") {
      result.tool_choice = { ...choice, disable_parallel_tool_use: true };
    }
  }

  if (toolNameMap.size > 0) {
    result._toolNameMap = toolNameMap;
  }

  return result;
}

function convertToolResultContent(content) {
  if (!Array.isArray(content)) return content;

  const parts = [];
  for (const part of content) {
    if (part.type === OPENAI_BLOCK.TEXT && part.text) {
      parts.push({ type: CLAUDE_BLOCK.TEXT, text: part.text });
    } else if (part.type === OPENAI_BLOCK.IMAGE_URL && part.image_url && part.image_url.url) {
      const url = part.image_url.url;
      const parsed = parseDataUri(url);
      if (parsed) {
        parts.push({
          type: CLAUDE_BLOCK.IMAGE,
          source: { type: "base64", media_type: parsed.mimeType, data: parsed.base64 }
        });
      } else if (url.startsWith("http://") || url.startsWith("https://")) {
        parts.push({ type: CLAUDE_BLOCK.IMAGE, source: { type: "url", url } });
      }
    } else if (part.type === CLAUDE_BLOCK.IMAGE && part.source) {
      parts.push({ type: CLAUDE_BLOCK.IMAGE, source: part.source });
    }
  }

  return parts.length > 0 ? parts : content;
}

function resolveToolResultIsError(source) {
  if (!source || typeof source !== "object") return false;
  if (source.is_error === true) return true;
  if (source.status === "error") return true;
  return false;
}

function buildToolResultBlock(toolUseId, content, source) {
  return {
    type: CLAUDE_BLOCK.TOOL_RESULT,
    tool_use_id: toolUseId,
    content,
    is_error: resolveToolResultIsError(source),
  };
}

function getContentBlocksFromMessage(msg, toolNameMap = new Map(), safeName = (name) => name) {
  const blocks = [];

  if (msg.role === ROLE.TOOL) {
    blocks.push(buildToolResultBlock(msg.tool_call_id, convertToolResultContent(msg.content), msg));
  } else if (msg.role === ROLE.USER) {
    if (typeof msg.content === "string") {
      if (msg.content) {
        blocks.push({ type: CLAUDE_BLOCK.TEXT, text: msg.content });
      }
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === OPENAI_BLOCK.TEXT && part.text) {
          blocks.push({ type: CLAUDE_BLOCK.TEXT, text: part.text });
        } else if (part.type === CLAUDE_BLOCK.TOOL_RESULT) {
          blocks.push(buildToolResultBlock(part.tool_use_id, part.content, part));
        } else if (part.type === OPENAI_BLOCK.IMAGE_URL) {
          const url = part.image_url.url;
          const parsed = parseDataUri(url);
          if (parsed) {
            blocks.push({
              type: CLAUDE_BLOCK.IMAGE,
              source: { type: "base64", media_type: parsed.mimeType, data: parsed.base64 }
            });
          } else if (url.startsWith("http://") || url.startsWith("https://")) {
            blocks.push({
              type: CLAUDE_BLOCK.IMAGE,
              source: { type: "url", url }
            });
          }
        } else if (part.type === OPENAI_BLOCK.IMAGE && part.source) {
          blocks.push({ type: CLAUDE_BLOCK.IMAGE, source: part.source });
        } else if (part.type === OPENAI_BLOCK.INPUT_AUDIO || part.type === OPENAI_BLOCK.AUDIO_URL) {
          blocks.push({ type: CLAUDE_BLOCK.TEXT, text: PLACEHOLDER_CURRENT.audioInput });
        } else if (part.type === OPENAI_BLOCK.FILE && part.file) {
          const fileData = part.file.file_data;
          const parsed = parseDataUri(fileData);
          if (parsed && parsed.mimeType === "application/pdf") {
            blocks.push({
              type: CLAUDE_BLOCK.DOCUMENT,
              source: { type: "base64", media_type: parsed.mimeType, data: parsed.base64 }
            });
          }
        }
      }
    }
  } else if (msg.role === ROLE.ASSISTANT) {
    if (typeof msg.reasoning_content === "string" && msg.reasoning_content) {
      blocks.push({ type: CLAUDE_BLOCK.THINKING, thinking: msg.reasoning_content });
    }
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === OPENAI_BLOCK.TEXT && part.text) {
          blocks.push({ type: CLAUDE_BLOCK.TEXT, text: part.text });
        } else if (part.type === CLAUDE_BLOCK.TOOL_USE) {
          blocks.push({ type: CLAUDE_BLOCK.TOOL_USE, id: part.id, name: part.name, input: part.input });
        } else if (part.type === CLAUDE_BLOCK.THINKING) {
          const { cache_control, ...thinkingBlock } = part;
          blocks.push(thinkingBlock);
        }
      }
    } else if (msg.content) {
      const text = typeof msg.content === "string" ? msg.content : extractTextContent(msg.content, "\n");
      if (text) {
        blocks.push({ type: CLAUDE_BLOCK.TEXT, text });
      }
    }

    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc.type === OPENAI_BLOCK.FUNCTION) {
          const toolName = CLAUDE_OAUTH_TOOL_PREFIX + safeName(tc.function.name);
          blocks.push({
            type: CLAUDE_BLOCK.TOOL_USE,
            id: tc.id,
            name: toolName,
            input: safeParseJSON(tc.function.arguments, tc.function.arguments)
          });
        }
      }
    }
  }

  return blocks;
}

const CLAUDE_TOOL_CHOICE_TYPES = new Set(["auto", "any", "tool", "none"]);

function convertOpenAIToolChoice(choice, safeName = (name) => name) {
  if (!choice) return { type: "auto" };

  if (typeof choice === "string") {
    if (choice === "required") return { type: "any" };
    if (choice === "none") return { type: "none" };
    return { type: "auto" };
  }

  if (typeof choice === "object") {
    if (choice.function?.name) {
      return { type: "tool", name: safeName(String(choice.function.name).trim()) };
    }
    if (CLAUDE_TOOL_CHOICE_TYPES.has(choice.type)) {
      if (choice.type === "tool" && typeof choice.name === "string") {
        return { ...choice, name: safeName(choice.name.trim()) };
      }
      return choice;
    }
  }

  return { type: "auto" };
}

function openaiToClaudeRequestForAntigravity(model, body, stream) {
  const result = openaiToClaudeRequest(model, body, stream);

  if (result.system && Array.isArray(result.system)) {
    result.system = result.system.filter(block =>
      !block.text || !block.text.includes("You are Claude Code")
    );
    if (result.system.length === 0) {
      delete result.system;
    }
  }

  if (result.tools && Array.isArray(result.tools)) {
    result.tools = result.tools.map(tool => {
      if (tool.name && tool.name.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)) {
        return {
          ...tool,
          name: tool.name.slice(CLAUDE_OAUTH_TOOL_PREFIX.length)
        };
      }
      return tool;
    });
  }

  if (result.messages && Array.isArray(result.messages)) {
    result.messages = result.messages.map(msg => {
      if (!msg.content || !Array.isArray(msg.content)) {
        return msg;
      }

      const updatedContent = msg.content.map(block => {
        if (block.type === CLAUDE_BLOCK.TOOL_USE && block.name && block.name.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)) {
          return {
            ...block,
            name: block.name.slice(CLAUDE_OAUTH_TOOL_PREFIX.length)
          };
        }
        return block;
      });

      return { ...msg, content: updatedContent };
    });
  }

  return result;
}

export { openaiToClaudeRequestForAntigravity };

register(FORMATS.OPENAI, FORMATS.CLAUDE, openaiToClaudeRequest, null);
