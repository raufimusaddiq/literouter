import { CLAUDE_BLOCK } from "../translator/schema/blocks.js";
import { isDeepSeekModel } from "../providers/models/helpers.js";

const DEDUP_RULES = [
  {
    triggers: ["mcp__exa__web_search_exa", "mcp__exa__web_fetch_exa"],
    strip: ["WebSearch", "WebFetch", "mcp__workspace__web_fetch"],
  },
  {
    triggers: ["mcp__tavily__tavily_search", "mcp__tavily__tavily_extract"],
    strip: ["WebSearch", "WebFetch", "mcp__workspace__web_fetch"],
  },
  {
    triggers: [/^mcp__browsermcp__/],
    strip: [/^mcp__Claude_in_Chrome__/],
  },
];

function getToolName(t) {
  return t?.name || t?.function?.name || "";
}

function matches(name, pattern) {
  if (typeof pattern === "string") return name === pattern;
  return pattern instanceof RegExp ? pattern.test(name) : false;
}

function cleanStrippedToolReferences(messages, strippedNames) {
  if (!Array.isArray(messages) || strippedNames.size === 0) return 0;
  let cleaned = 0;
  for (const msg of messages) {
    const content = msg?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== CLAUDE_BLOCK.TOOL_RESULT || !Array.isArray(block.content)) continue;
      const removed = block.content.filter(
        (p) => p?.type === CLAUDE_BLOCK.TOOL_REFERENCE && strippedNames.has(p.tool_name)
      );
      if (removed.length === 0) continue;
      cleaned += removed.length;
      const kept = block.content.filter((p) => !removed.includes(p));
      block.content = kept.length
        ? kept
        : [{ type: CLAUDE_BLOCK.TEXT, text: removed.map((p) => `[Tool ${p.tool_name} is unavailable]`).join("\n") }];
    }
  }
  return cleaned;
}

function dedupeTools(tools, opts = {}) {
  if (!Array.isArray(tools) || tools.length === 0) return { tools, stripped: [] };
  const names = tools.map(getToolName);
  const toStrip = new Set();
  const toDrop = new Set();

  if (opts.clientTool === "claude") {
    for (const rule of DEDUP_RULES) {
      const hasTrigger = names.some((n) => rule.triggers.some((p) => matches(n, p)));
      if (!hasTrigger) continue;
      for (const n of names) {
        if (rule.strip.some((p) => matches(n, p))) toStrip.add(n);
      }
    }
  }

  if (isDeepSeekModel(opts.model)) {
    const seen = new Set();
    for (let i = 0; i < tools.length; i++) {
      const n = getToolName(tools[i]);
      if (!n) continue;
      if (seen.has(n)) toDrop.add(i);
      else seen.add(n);
    }
  }

  if (toStrip.size === 0 && toDrop.size === 0) return { tools, stripped: [] };
  cleanStrippedToolReferences(opts.messages, toStrip);
  const out = tools.filter((t, i) => !toDrop.has(i) && !toStrip.has(getToolName(t)));
  const stripped = Array.from(toDrop).map((i) => getToolName(tools[i])).concat(Array.from(toStrip));
  return { tools: out, stripped };
}

export { dedupeTools };
