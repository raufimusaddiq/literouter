import { OPENAI_BLOCK } from "../schema/index.js";

export function stripAnthropicBillingHeader(text) {
  if (typeof text !== "string") return "";
  return text.replace(/^x-anthropic-billing-header:[^\n]*(?:\r?\n)?/i, "");
}

export function collapseTextParts(parts) {
  return parts.length === 1 && parts[0].type === OPENAI_BLOCK.TEXT ? parts[0].text : parts;
}
