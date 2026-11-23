import { DEFAULT_THINKING_CLAUDE_SIGNATURE } from "../../config/defaultThinkingSignature.js";
import { ROLE, CLAUDE_BLOCK } from "../schema/index.js";
import { adjustMaxTokens } from "./maxTokens.js";
import { applyCloaking } from "../../utils/claudeCloaking.js";
import { resolveSessionId } from "../../utils/sessionManager.js";
import { isValidClaudeSignature } from "../../utils/claudeSignature.js";
import { PROVIDERS } from "../../providers/index.js";
import { getCapabilitiesForModel } from "../../providers/capabilities.js";
import { isDeepSeekModel } from "../../providers/models/helpers.js";
import { DEFAULT_MAX_TOKENS } from "../../config/runtimeConfig.js";

const CACHE_CONTROL_5M = { type: "ephemeral" };
const CACHE_CONTROL_1H = { type: "ephemeral", ttl: "1h" };

export function lastCacheableToolIndex(tools) {
  if (!Array.isArray(tools)) return -1;
  for (let i = tools.length - 1; i >= 0; i--) {
    if (tools[i]?.defer_loading !== true) return i;
  }
  return -1;
}

const CONTENTFUL_BLOCKS = new Set([
  CLAUDE_BLOCK.TOOL_USE,
  CLAUDE_BLOCK.TOOL_RESULT,
  CLAUDE_BLOCK.IMAGE,
  CLAUDE_BLOCK.DOCUMENT,
  CLAUDE_BLOCK.CONTAINER_UPLOAD,
]);

function isContentfulBlock(block) {
  if (!block) return false;
  if (block.type === CLAUDE_BLOCK.TEXT) return !!block.text?.trim();
  return CONTENTFUL_BLOCKS.has(block.type);
}

export function hasValidContent(msg) {
  if (typeof msg.content === "string" && msg.content.trim()) return true;
  if (msg.content && typeof msg.content === "object" && !Array.isArray(msg.content)) {
    return isContentfulBlock(msg.content);
  }
  if (Array.isArray(msg.content)) {
    return msg.content.some(isContentfulBlock);
  }
  return false;
}
function normalizeMessageContent(msg) {
  const c = msg?.content;
  if (c && typeof c === "object" && !Array.isArray(c)) {
    delete c.cache_control;
    msg.content = [c];
  }
  return msg;
}

function countCacheControlBlocks(body) {
  let n = 0;
  if (Array.isArray(body?.system)) for (const b of body.system) if (b?.cache_control) n++;
  if (Array.isArray(body?.tools)) for (const t of body.tools) if (t?.cache_control) n++;
  if (Array.isArray(body?.messages)) {
    for (const m of body.messages) {
      if (Array.isArray(m?.content)) {
        for (const b of m.content) if (b?.cache_control) n++;
      } else if (m?.content && typeof m.content === "object" && m.content.cache_control) n++;
    }
  }
  return n;
}
function capCacheControlBlocks(body) {
  const isHead = (b) => {
    const sys = Array.isArray(body?.system) ? body.system : [];
    if (sys.length && sys[sys.length - 1] === b) return true;
    const tools = Array.isArray(body?.tools) ? body.tools : [];
    const lastTool = lastCacheableToolIndex(tools);
    return lastTool >= 0 && tools[lastTool] === b;
  };
  const marked = [];
  if (Array.isArray(body?.system)) for (const b of body.system) if (b?.cache_control) marked.push(b);
  if (Array.isArray(body?.tools)) for (const t of body.tools) if (t?.cache_control) marked.push(t);
  if (Array.isArray(body?.messages)) {
    for (const m of body.messages) {
      if (Array.isArray(m?.content)) for (const b of m.content) if (b?.cache_control) marked.push(b);
    }
  }
  const head = marked.filter(isHead);
  const rest = marked.filter(b => !isHead(b));
  const keep = Math.max(0, 4 - head.length);
  for (const b of rest.slice(0, Math.max(0, rest.length - keep))) delete b.cache_control;
}

export function fixToolUseOrdering(messages) {
  if (messages.length <= 1) return messages;

  for (const msg of messages) {
    if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.content)) {
      const hasToolUse = msg.content.some(b => b.type === CLAUDE_BLOCK.TOOL_USE);
      if (hasToolUse) {
        const newContent = [];
        let foundToolUse = false;

        for (const block of msg.content) {
          if (block.type === CLAUDE_BLOCK.TOOL_USE) {
            foundToolUse = true;
            newContent.push(block);
          } else if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) {
            newContent.push(block);
          } else if (!foundToolUse) {
            newContent.push(block);
          }
        }

        msg.content = newContent;
      }
    }
  }

  const merged = [];

  for (const msg of messages) {
    const last = merged[merged.length - 1];

    if (last && last.role === msg.role) {
      const lastContent = Array.isArray(last.content) ? last.content : [{ type: CLAUDE_BLOCK.TEXT, text: last.content }];
      const msgContent = Array.isArray(msg.content) ? msg.content : [{ type: CLAUDE_BLOCK.TEXT, text: msg.content }];

      const toolResults = [...lastContent.filter(b => b.type === CLAUDE_BLOCK.TOOL_RESULT), ...msgContent.filter(b => b.type === CLAUDE_BLOCK.TOOL_RESULT)];
      const otherContent = [...lastContent.filter(b => b.type !== CLAUDE_BLOCK.TOOL_RESULT), ...msgContent.filter(b => b.type !== CLAUDE_BLOCK.TOOL_RESULT)];

      last.content = [...toolResults, ...otherContent];
    } else {
      const content = Array.isArray(msg.content) ? msg.content : [{ type: CLAUDE_BLOCK.TEXT, text: msg.content }];
      merged.push({ role: msg.role, content: [...content] });
    }
  }

  return merged;
}

function isAdaptiveThinkingUnsupported(model = "") {
  if (!/haiku/i.test(model)) return false;
  const m = String(model).match(/haiku[-._]?(\d+)|(?<![\d.])(\d+)(?:[-._]\d+)?[-._]?haiku/i);
  return m ? Number(m[1] || m[2]) < 5 : true;
}

function handlesThinkingBlocks(provider) {
  return provider === "claude" || provider?.startsWith("anthropic-compatible") || provider === "deepseek";
}

function buildThinkingPlaceholder(provider, unsigned = false) {
  const block = {
    type: CLAUDE_BLOCK.THINKING,
    thinking: ".",
  };

  if (provider !== "deepseek" && !unsigned) {
    block.signature = DEFAULT_THINKING_CLAUDE_SIGNATURE;
  }

  return block;
}

const CLAUDE_SERVER_TOOL_USE_ID = /^srvtoolu_[a-zA-Z0-9_]+$/;

function hasForeignServerToolUseId(block) {
  return block?.type === CLAUDE_BLOCK.SERVER_TOOL_USE
    && !CLAUDE_SERVER_TOOL_USE_ID.test(String(block.id ?? ""));
}

export function normalizeClaudePassthrough(body, model = "") {
  if (!body || typeof body !== "object") return body;

  if (body.thinking?.type === "adaptive" && isAdaptiveThinkingUnsupported(model)) {
    body.thinking = { type: "enabled", budget_tokens: 10000 };
  }

  if (isAdaptiveThinkingUnsupported(model) && body.output_config?.effort != null) {
    delete body.output_config.effort;
    if (Object.keys(body.output_config).length === 0) delete body.output_config;
  }

  const originalLastRole = Array.isArray(body.messages) ? body.messages[body.messages.length - 1]?.role : undefined;

  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) normalizeMessageContent(msg);
  }

  if (Array.isArray(body.messages)) {
    const messages = [];
    for (const msg of body.messages) {
      if (msg.role !== ROLE.SYSTEM) {
        messages.push(msg);
        continue;
      }
      const text = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map(b => (typeof b === "string" ? b : b?.text || "")).join("\n")
          : "";
      if (!text.trim()) continue;

      const block = { type: CLAUDE_BLOCK.TEXT, text };
      const prev = messages[messages.length - 1];
      if (prev?.role === ROLE.USER) {
        const content = typeof prev.content === "string"
          ? [{ type: CLAUDE_BLOCK.TEXT, text: prev.content }]
          : Array.isArray(prev.content) ? [...prev.content] : [];
        messages[messages.length - 1] = { ...prev, content: [...content, block] };
        continue;
      }
      messages.push({ role: ROLE.USER, content: [block] });
    }
    body.messages = messages;
  }

  const thinkingEnabled = body.thinking?.type === "enabled";
  const droppedServerToolUseIds = new Set();
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.role !== ROLE.ASSISTANT || !Array.isArray(msg.content)) continue;
      let hasToolUse = false;
      let hasKeptThinking = false;
      const kept = [];
      for (const block of msg.content) {
        if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) {
          if (isValidClaudeSignature(block.signature)) {
            hasKeptThinking = true;
            kept.push(block);
          }
          continue;
        }
        if (hasForeignServerToolUseId(block)) {
          if (block.id != null) droppedServerToolUseIds.add(String(block.id));
          continue;
        }
        if (block.type === CLAUDE_BLOCK.TOOL_USE) hasToolUse = true;
        kept.push(block);
      }
      msg.content = kept;
      if (thinkingEnabled && !hasKeptThinking && hasToolUse) {
        msg.content.unshift(buildThinkingPlaceholder("claude"));
      }
    }
  }

  if (droppedServerToolUseIds.size > 0 && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (!Array.isArray(msg.content)) continue;
      const kept = msg.content.filter(block => !(
        (block?.type === CLAUDE_BLOCK.TOOL_RESULT || block?.type === CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT)
        && droppedServerToolUseIds.has(String(block.tool_use_id ?? ""))
      ));
      if (kept.length !== msg.content.length) {
        msg.content = kept;
      }
    }
  }

  if (Array.isArray(body.messages)) {
    body.messages = body.messages.filter(msg => {
      if (typeof msg.content === "string") return msg.content.trim().length > 0;
      if (!Array.isArray(msg.content)) return true;
      msg.content = msg.content.filter(block =>
        !(block?.type === CLAUDE_BLOCK.TEXT && !String(block.text ?? "").trim()));
      return msg.content.length > 0;
    });
    body.messages = ensureTrailingUserTurn(body.messages, originalLastRole);
  }

  return body;
}

const TRAILING_USER_PLACEHOLDER = "Continue.";

export function ensureTrailingUserTurn(messages, originalLastRole) {
  if (!Array.isArray(messages) || originalLastRole === ROLE.ASSISTANT) return messages;
  if (messages[messages.length - 1]?.role !== ROLE.ASSISTANT) return messages;
  return [...messages, { role: ROLE.USER, content: [{ type: CLAUDE_BLOCK.TEXT, text: TRAILING_USER_PLACEHOLDER }] }];
}

function markLastCacheableBlock(msg) {
  if (!Array.isArray(msg?.content)) return false;
  for (let i = msg.content.length - 1; i >= 0; i--) {
    const block = msg.content[i];
    if (typeof block !== "object" || block === null) continue;
    if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) continue;
    block.cache_control = { ...CACHE_CONTROL_5M };
    return true;
  }
  return false;
}

function markFinalToolResults(body) {
  const messages = body?.messages;
  const last = Array.isArray(messages) ? messages[messages.length - 1] : null;
  if (last?.role !== ROLE.USER || !Array.isArray(last.content)) return false;
  if (!last.content.some((block) => block?.type === CLAUDE_BLOCK.TOOL_RESULT)) return false;
  if (last.content.some((block) => block?.cache_control)) return false;
  if (countCacheControlBlocks(body) >= 4) return false;
  return markLastCacheableBlock(last);
}

export function anchorClaudeCache(body) {
  if (!body || typeof body !== "object") return body;
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) normalizeMessageContent(msg);
  }
  if (Array.isArray(body.tools)) {
    for (const t of body.tools) {
      if (t?.defer_loading === true) delete t.cache_control;
    }
  }

  if (Array.isArray(body.system)) {
    const last = body.system.length - 1;
    body.system.forEach((block, i) => {
      if (typeof block !== "object" || block === null) return;
      if (i === last) block.cache_control = { ...CACHE_CONTROL_1H };
      else delete block.cache_control;
    });
  }

  if (Array.isArray(body.tools)) {
    const last = lastCacheableToolIndex(body.tools);
    body.tools.forEach((tool, i) => {
      if (i === last) tool.cache_control = { ...CACHE_CONTROL_1H };
      else delete tool.cache_control;
    });
  }

  if (countCacheControlBlocks(body) >= 4) {
    capCacheControlBlocks(body);
    return body;
  }

  if (Array.isArray(body.messages)) {
    let anchored = null;
    for (let i = body.messages.length - 1; i >= 0; i--) {
      const msg = body.messages[i];
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) delete block.cache_control;

      if (anchored || msg.role !== ROLE.ASSISTANT) continue;
      anchored = markLastCacheableBlock(msg);
    }

    if (!anchored) {
      for (let i = body.messages.length - 1; i >= 0 && !anchored; i--) {
        anchored = markLastCacheableBlock(body.messages[i]);
      }
    }

    markFinalToolResults(body);
  }

  return body;
}

export function hoistToolResultImages(body) {
  if (!Array.isArray(body?.messages)) return body;
  let touched = false;
  const messages = body.messages.map((msg) => {
    if (msg?.role !== ROLE.USER || !Array.isArray(msg.content)) return msg;
    const hoisted = [];
    const content = msg.content.map((block) => {
      if (block?.type !== CLAUDE_BLOCK.TOOL_RESULT || !Array.isArray(block.content)) return block;
      const images = block.content.filter((c) => c?.type === CLAUDE_BLOCK.IMAGE);
      if (!images.length) return block;
      const rest = block.content.filter((c) => c?.type !== CLAUDE_BLOCK.IMAGE);
      hoisted.push({ type: CLAUDE_BLOCK.TEXT, text: `[Image from tool result ${block.tool_use_id}]` }, ...images);
      return { ...block, content: rest.length ? rest : [{ type: CLAUDE_BLOCK.TEXT, text: "(image attached below)" }] };
    });
    if (!hoisted.length) return msg;
    touched = true;
    return { ...msg, content: [...content, ...hoisted] };
  });
  return touched ? { ...body, messages } : body;
}

export function prepareClaudeRequest(body, provider = null, apiKey = null, connectionId = null, rawHeaders = null, sessionId = null) {
  if (PROVIDERS[provider]?.quirks?.dropOutputConfig) {
    delete body.output_config;
  }

  if (body.max_tokens) {
    const ceiling = getCapabilitiesForModel(provider, body.model).maxOutput || DEFAULT_MAX_TOKENS;
    if (body.max_tokens > ceiling) body.max_tokens = ceiling;

    if (body.thinking?.type === "enabled" && body.thinking.budget_tokens && body.thinking.budget_tokens >= body.max_tokens) {
      body.max_tokens = Math.min(body.thinking.budget_tokens + 1024, ceiling);
      if (body.thinking.budget_tokens >= body.max_tokens) {
        body.thinking.budget_tokens = Math.max(1024, body.max_tokens - 1024);
      }
    }
  }

  if (body.system && Array.isArray(body.system)) {
    body.system = body.system.map((block, i) => {
      const { cache_control, ...rest } = block;
      if (i === body.system.length - 1) {
        return { ...rest, cache_control: { type: "ephemeral", ttl: "1h" } };
      }
      return rest;
    });
  }

  if (body.messages && Array.isArray(body.messages)) {
    const len = body.messages.length;
    const originalLastRole = body.messages[len - 1]?.role;
    let filtered = [];

    for (let i = 0; i < len; i++) {
      const msg = body.messages[i];
      normalizeMessageContent(msg);

      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          delete block.cache_control;
        }
      }

      const isFinalAssistant = i === len - 1 && msg.role === "assistant";
      if (isFinalAssistant || hasValidContent(msg)) {
        filtered.push(msg);
      }
    }

    filtered = fixToolUseOrdering(filtered);
    filtered = ensureTrailingUserTurn(filtered, originalLastRole);

    body.messages = filtered;

    const lastMessage = filtered[filtered.length - 1];
    const lastMessageIsUser = lastMessage?.role === "user";

    const deepSeekServed =
      provider === "deepseek" ||
      (provider === "opencode-go" && isDeepSeekModel(body?.model));
    const thinkingEnabled = lastMessageIsUser && (
      body.thinking?.type === "enabled" ||
      (deepSeekServed && body.thinking?.type === "adaptive")
    );

    let lastAssistantProcessed = false;
    for (let i = filtered.length - 1; i >= 0; i--) {
      const msg = filtered[i];

      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        if (!lastAssistantProcessed && msg.content.length > 0) {
          for (let j = msg.content.length - 1; j >= 0; j--) {
            const block = msg.content[j];
            if (block.type !== CLAUDE_BLOCK.THINKING && block.type !== CLAUDE_BLOCK.REDACTED_THINKING) {
              block.cache_control = { type: "ephemeral" };
              break;
            }
          }
          lastAssistantProcessed = true;
        }

        if (handlesThinkingBlocks(provider) || deepSeekServed) {
          let hasToolUse = false;
          let hasKeptThinking = false;

          const isClaudeNative = provider === "claude";
          const kept = [];
          for (const block of msg.content) {
            const isThinking = block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING;
            if (isThinking) {
              if (isClaudeNative) {
                if (isValidClaudeSignature(block.signature)) {
                  hasKeptThinking = true;
                  kept.push(block);
                }
              } else if (deepSeekServed) {
                hasKeptThinking = true;
                kept.push(block);
              } else {
                block.signature = DEFAULT_THINKING_CLAUDE_SIGNATURE;
                hasKeptThinking = true;
                kept.push(block);
              }
              continue;
            }
            if (block.type === CLAUDE_BLOCK.TOOL_USE) hasToolUse = true;
            kept.push(block);
          }
          msg.content = kept;

          if (thinkingEnabled && !hasKeptThinking && hasToolUse) {
            msg.content.unshift(buildThinkingPlaceholder(provider, deepSeekServed));
          }
        }
      }
    }
  }

  if (body.tools && Array.isArray(body.tools)) {
    if (provider !== "claude") {
      const supportedTypes = PROVIDERS[provider]?.quirks?.claudeSupportedToolTypes;
      const hasWhitelist = Array.isArray(supportedTypes);
      body.tools = body.tools
        .filter(tool => {
          const t = tool?.type;
          if (!t || t === "function") return true;
          if (hasWhitelist) return supportedTypes.includes(t);
          return false;
        })
        .map(tool => {
          if (tool.function) {
            return {
              name: tool.function.name,
              description: tool.function.description,
              input_schema: tool.function.parameters,
            };
          }
          if (hasWhitelist) return tool;
          const { type, ...rest } = tool;
          return rest;
        });
    }

    const lastCacheable = lastCacheableToolIndex(body.tools);
    body.tools = body.tools.map((tool, i) => {
      const { cache_control, ...rest } = tool;
      if (i === lastCacheable) {
        return { ...rest, cache_control: { type: "ephemeral", ttl: "1h" } };
      }
      return rest;
    });

    if (body.tools.length === 0) {
      delete body.tools;
      delete body.tool_choice;
    }
  }

  if (provider !== "claude" && !provider?.startsWith("anthropic-compatible")) {
    body = hoistToolResultImages(body);
  }

  markFinalToolResults(body);

  if ((provider === "claude" || provider?.startsWith("anthropic-compatible")) && apiKey) {
    const sid = sessionId || resolveSessionId({ headers: rawHeaders, body, connectionId, scope: "claude" });
    body = applyCloaking(body, apiKey, sid);
  }

  return body;
}
