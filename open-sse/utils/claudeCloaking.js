import { createHash, randomBytes, randomUUID } from "crypto";
import { CLAUDE_TOOL_SUFFIX, CC_DEFAULT_TOOLS } from "../config/appConstants.js";
import "../providers/shared.js";
import { getClaudeCliVersion } from "./claudeCliVersion.js";
import { CLAUDE_BLOCK } from "../translator/schema/blocks.js";
import { CLAUDE_EVENT } from "../translator/schema/index.js";

const CC_ENTRYPOINT = "sdk-cli";

function generateBillingHeader(payload) {
  const content = JSON.stringify(payload);
  const cch = createHash("sha256").update(content).digest("hex").slice(0, 5);
  const buildHash = randomBytes(2).toString("hex").slice(0, 3);
  return `x-anthropic-billing-header: cc_version=${getClaudeCliVersion()}.${buildHash}; cc_entrypoint=${CC_ENTRYPOINT}; cch=${cch};`;
}

function deriveUuid(seed) {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function generateFakeUserID(sessionId, apiKey) {
  const deviceId = apiKey ? createHash("sha256").update(`device:${apiKey}`).digest("hex") : randomBytes(32).toString("hex");
  const accountUuid = apiKey ? deriveUuid(`account:${apiKey}`) : randomUUID();
  const cleanSessionId = typeof sessionId === "string" ? sessionId.replace(/^claude:/i, "").trim() : null;
  const sessionUuid = cleanSessionId || randomUUID();
  return `{"device_id":"${deviceId}","account_uuid":"${accountUuid}","session_id":"${sessionUuid}"}`;
}

export function extractClaudeSessionIdFromUserId(userId) {
  if (typeof userId !== "string" || !userId) return null;
  if (userId[0] === "{") {
    try {
      const sid = JSON.parse(userId)?.session_id;
      return typeof sid === "string" && sid ? sid.replace(/^claude:/i, "").trim() || null : null;
    } catch {
      return null;
    }
  }
  const clean = userId.replace(/^claude:/i, "").trim();
  return clean || null;
}

export function cloakClaudeTools(body) {
  const tools = body.tools;
  if (!tools || tools.length === 0) return { body, toolNameMap: null };

  const suffix = (name) => `${name}${CLAUDE_TOOL_SUFFIX}`;
  const toolNameMap = new Map();
  const clientToolNames = new Set();
  const clientDeclarations = [];

  for (const tool of tools) {
    if (tool.type) { clientDeclarations.push(tool); continue; }
    const suffixed = suffix(tool.name);
    toolNameMap.set(suffixed, tool.name);
    clientToolNames.add(tool.name);
    clientDeclarations.push({ ...tool, name: suffixed });
  }

  const allTools = [...clientDeclarations, ...CC_DECOY_TOOLS];

  const renameToolReferences = (content) => content.map(part =>
    part?.type === CLAUDE_BLOCK.TOOL_REFERENCE && clientToolNames.has(part.tool_name)
      ? { ...part, tool_name: suffix(part.tool_name) }
      : part
  );

  const renamedMessages = body.messages?.map(msg => {
    if (!Array.isArray(msg.content)) return msg;
    const renamedContent = msg.content.map(block => {
      if (block.type === CLAUDE_BLOCK.TOOL_USE) return { ...block, name: suffix(block.name) };
      if (block.type === CLAUDE_BLOCK.TOOL_RESULT && Array.isArray(block.content)) {
        return { ...block, content: renameToolReferences(block.content) };
      }
      return block;
    });
    return { ...msg, content: renamedContent };
  });

  const cloakedBody = { ...body, tools: allTools, messages: renamedMessages || body.messages };

  if (
    body.tool_choice?.type === "tool" &&
    clientToolNames.has(body.tool_choice.name)
  ) {
    cloakedBody.tool_choice = { ...body.tool_choice, name: suffix(body.tool_choice.name) };
  }

  return {
    body: cloakedBody,
    toolNameMap: toolNameMap.size > 0 ? toolNameMap : null
  };
}

function stripCloakSuffix(name) {
  if (typeof name !== "string" || !name.endsWith(CLAUDE_TOOL_SUFFIX)) return null;
  if (CC_DEFAULT_TOOLS.has(name)) return null;
  const original = name.slice(0, -CLAUDE_TOOL_SUFFIX.length);
  return original.length > 0 ? original : null;
}

export function decloakToolNames(body, toolNameMap) {
  if (!Array.isArray(body?.content)) return body;
  const content = body.content.map(block => {
    if (block?.type !== "tool_use") return block;
    if (toolNameMap?.has(block.name)) {
      return { ...block, name: toolNameMap.get(block.name) };
    }
    const fallback = stripCloakSuffix(block.name);
    return fallback ? { ...block, name: fallback } : block;
  });
  return { ...body, content };
}

export function decloakStreamChunk(chunk, toolNameMap) {
  if (!chunk || typeof chunk !== "object") return chunk;
  if (chunk.type !== CLAUDE_EVENT.CONTENT_BLOCK_START) return chunk;
  const block = chunk.content_block;
  if (block?.type !== "tool_use" || typeof block.name !== "string") return chunk;
  const original = toolNameMap?.get(block.name) || stripCloakSuffix(block.name);
  if (!original) return chunk;
  return { ...chunk, content_block: { ...block, name: original } };
}

const CC_DECOY_TOOLS = [
  { name: "Task", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "TaskOutput", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "TaskStop", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "TaskCreate", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "TaskGet", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "TaskUpdate", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "TaskList", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "Bash", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "Glob", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "Grep", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "Read", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "Edit", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "Write", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "NotebookEdit", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "WebFetch", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "WebSearch", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "AskUserQuestion", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "Skill", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "EnterPlanMode", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "ExitPlanMode", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
];

export function applyCloaking(body, apiKey, sessionId) {
  if (!apiKey || !apiKey.includes("sk-ant-oat")) return body;

  const result = { ...body };

  const billingText = generateBillingHeader(body);
  const billingBlock = { type: "text", text: billingText };

  if (Array.isArray(result.system)) {
    if (!result.system[0]?.text?.startsWith("x-anthropic-billing-header:")) {
      result.system = [billingBlock, ...result.system];
    }
  } else if (typeof result.system === "string") {
    result.system = [billingBlock, { type: "text", text: result.system }];
  } else {
    result.system = [billingBlock];
  }

  const existingUserId = result.metadata?.user_id;
  if (!existingUserId) {
    result.metadata = { ...result.metadata, user_id: generateFakeUserID(sessionId, apiKey) };
  }

  return result;
}
