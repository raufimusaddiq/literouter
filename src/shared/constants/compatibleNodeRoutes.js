// Derive per-node client transport routes from a compatible provider node.
// One source of truth for the API layer, routing executor, and UI.
// Legacy openai-compatible nodes with apiType "chat" keep chat + translation
// fallback; new nodes may advertise several native transports at once.

export const CHAT_PATH = "/chat/completions";
export const RESPONSES_PATH = "/responses";
export const MESSAGES_PATH = "/messages";

export function nodeRoutes(node) {
  if (!node) return null;
  const baseUrl = (node.baseUrl || "").replace(/\/$/, "");
  const declared = Array.isArray(node.transports) && node.transports.length
    ? node.transports.filter((t) => ["chat_completions", "responses", "messages"].includes(t))
    : null;

  let transports = declared;
  if (!transports) {
    if (node.type === "anthropic-compatible") transports = ["messages"];
    else if (node.apiType === "responses") transports = ["responses"];
    else transports = ["chat_completions"];
  }

  return transports.map((transport) => ({
    transport,
    format: transport === "messages" ? "claude" : transport === "chat_completions" ? "openai" : "openai-responses",
    path: transport === "messages" ? MESSAGES_PATH : transport === "chat_completions" ? CHAT_PATH : RESPONSES_PATH,
    baseUrl,
  }));
}

export function preferredApiType(node) {
  const routes = nodeRoutes(node) || [];
  if (routes.some((r) => r.format === "openai")) return "chat";
  if (routes.some((r) => r.format === "openai-responses")) return "responses";
  return null;
}
