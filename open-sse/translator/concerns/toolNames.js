// Upstreams such as Codex (Responses) and Anthropic require tool names matching
// ^[a-zA-Z0-9_-]{1,128}$. MCP-style names ("server.tool") are rewritten for the
// upstream and mapped back on the response. Names that are already valid are
// reserved first so an alias can never collide with a real tool.
const MAX_TOOL_NAME_LEN = 128;
export const VALID_TOOL_NAME = new RegExp(`^[a-zA-Z0-9_-]{1,${MAX_TOOL_NAME_LEN}}$`);

export function createToolNameSanitizer(declaredNames = []) {
  const used = new Set(declaredNames.filter((name) => VALID_TOOL_NAME.test(name)));
  const toOriginal = new Map();
  const toSafe = new Map();
  const safe = (original) => {
    if (VALID_TOOL_NAME.test(original)) return original;
    if (toSafe.has(original)) return toSafe.get(original);
    const base = original.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, MAX_TOOL_NAME_LEN) || "tool";
    let candidate = base;
    let n = 2;
    while (used.has(candidate)) {
      const suffix = `_${n++}`;
      candidate = base.slice(0, MAX_TOOL_NAME_LEN - suffix.length) + suffix;
    }
    used.add(candidate);
    toOriginal.set(candidate, original);
    toSafe.set(original, candidate);
    return candidate;
  };
  return { safe, toOriginal };
}

// Every tool name a Chat Completions request mentions: declarations, assistant
// history, and an explicit tool_choice.
export function collectChatToolNames(body) {
  return [
    ...(Array.isArray(body.tools) ? body.tools.map((tool) => tool?.function?.name ?? tool?.name) : []),
    ...(Array.isArray(body.messages) ? body.messages.flatMap((msg) => (Array.isArray(msg?.tool_calls) ? msg.tool_calls.map((tc) => tc?.function?.name) : [])) : []),
    body.tool_choice?.function?.name,
    body.tool_choice?.name,
  ].filter((name) => typeof name === "string").map((name) => name.trim()).filter(Boolean);
}
