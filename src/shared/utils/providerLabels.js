// Readable labels for provider rows (Overview). Never surfaces raw ids, uuids or full emails.
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmail = (value) => typeof value === "string" && EMAIL_RE.test(value.trim());

// True for uuids and internal ids such as "openai-compatible-chat-<uuid>".
export const isRawId = (value) => typeof value === "string" && UUID_RE.test(value);

export function maskEmail(email) {
  const [local, domain] = String(email).trim().split("@");
  if (!local || !domain) return "";
  return `${local.slice(0, 3)}…@${domain}`;
}

// nodes: array of provider nodes ({ id, name }) from /api/provider-nodes.
export function getProviderLabel(providerId, nodes = []) {
  if (!providerId) return "Unknown provider";
  const node = nodes.find((n) => n?.id === providerId);
  if (node?.name && !isRawId(node.name)) return node.name;
  const config = AI_PROVIDERS[providerId] || getProviderByAlias(providerId);
  if (config?.name) return config.name;
  return isRawId(providerId) ? "Custom provider" : providerId;
}

// Short account label: human connection name, else masked email, else "default".
// `providerLabel` (optional): a name that merely repeats the row title counts as no label.
export function getAccountLabel(connection = {}, providerLabel = "") {
  const name = typeof connection.name === "string" ? connection.name.trim() : "";
  if (name && !isEmail(name) && !isRawId(name) && name !== providerLabel) return name;
  const email = [connection.email, name].find(isEmail);
  if (email) return maskEmail(email);
  return "default";
}
