import { json } from "@/server/http.js";
import { createProviderNode, getProviderNodes } from "@/models";
import { OPENAI_COMPATIBLE_PREFIX, ANTHROPIC_COMPATIBLE_PREFIX, SYSTEM_ONE_PREFIX } from "@/shared/constants/providers";
import { generateId } from "@/shared/utils";
import { assertPublicUrlResolved } from "@/shared/utils/ssrfGuard.js";
import { isLocalRequest } from "@/server/guard.js";
import { PROVIDERS } from "open-sse/config/providers.js";

const PROVIDER_NODE_RESERVED_PREFIXES = new Set(Object.keys(PROVIDERS).flatMap((id) => {
  const entry = PROVIDERS[id];
  return [id, entry?.alias, ...(entry?.aliases || [])].filter(Boolean);
}));

const OPENAI_COMPATIBLE_DEFAULTS = {
  baseUrl: "https://api.openai.com/v1",
};

const ANTHROPIC_COMPATIBLE_DEFAULTS = {
  baseUrl: "https://api.anthropic.com/v1",
};

export async function GET() {
  try {
    const nodes = await getProviderNodes();
    return json({ nodes });
  } catch (error) {
    console.log("Error fetching provider nodes:", error);
    return json({ error: "Failed to fetch provider nodes" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { name, prefix, apiType, baseUrl, type } = body;

    if (!name?.trim()) {
      return json({ error: "Name is required" }, { status: 400 });
    }

    if (!prefix?.trim()) {
      return json({ error: "Prefix is required" }, { status: 400 });
    }

    const nodeType = type || "openai-compatible";

    if (nodeType === "openai-compatible") {
      const transports = Array.isArray(body.transports)
        ? body.transports.filter((t) => ["chat_completions", "responses", "messages"].includes(t))
        : null;
      if (!transports?.length && (!apiType || !["chat", "responses"].includes(apiType))) {
        return json({ error: "Invalid OpenAI compatible API type" }, { status: 400 });
      }

      const node = await createProviderNode({
        id: `${OPENAI_COMPATIBLE_PREFIX}${(transports?.includes("chat_completions") || !transports) ? (apiType || "chat") : "responses"}-${generateId()}`,
        type: "openai-compatible",
        prefix: prefix.trim(),
        apiType: apiType || (transports?.includes("chat_completions") ? "chat" : "responses"),
        transports: transports || undefined,
        baseUrl: (baseUrl || OPENAI_COMPATIBLE_DEFAULTS.baseUrl).trim(),
        name: name.trim(),
      });
      return json({ node }, { status: 201 });
    }

    if (nodeType === "anthropic-compatible") {
      let sanitizedBaseUrl = (baseUrl || ANTHROPIC_COMPATIBLE_DEFAULTS.baseUrl).trim().replace(/\/$/, "");
      if (sanitizedBaseUrl.endsWith("/messages")) {
        sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -9);
      }

      const node = await createProviderNode({
        id: `${ANTHROPIC_COMPATIBLE_PREFIX}${generateId()}`,
        type: "anthropic-compatible",
        prefix: prefix.trim(),
        baseUrl: sanitizedBaseUrl,
        name: name.trim(),
      });
      return json({ node }, { status: 201 });
    }

    if (nodeType === "systemone") {
      const trimmedPrefix = prefix.trim();
      if (trimmedPrefix.startsWith(SYSTEM_ONE_PREFIX) || PROVIDER_NODE_RESERVED_PREFIXES.has(trimmedPrefix)) {
        return json({ error: "Reserved prefix" }, { status: 400 });
      }
      const sanitizedBaseUrl = baseUrl.trim().replace(/\/$/, "");
      try {
        new URL(sanitizedBaseUrl);
      } catch {
        return json({ error: "Invalid URL format" }, { status: 400 });
      }
      const localOperator = isLocalRequest(request);
      try {
        await assertPublicUrlResolved(sanitizedBaseUrl, { allowPrivate: localOperator });
      } catch {
        return json({ error: "URL not allowed" }, { status: 400 });
      }
      const existingNodes = await getProviderNodes();
      if (existingNodes.some((node) => node.prefix === trimmedPrefix)) {
        return json({ error: "Prefix already in use" }, { status: 400 });
      }
      const node = await createProviderNode({
        id: `${SYSTEM_ONE_PREFIX}${generateId()}`,
        type: "systemone",
        prefix: trimmedPrefix,
        baseUrl: sanitizedBaseUrl,
        name: name.trim(),
        defaultModels: Array.isArray(body.models)
          ? body.models.map((m) => String(m).trim()).filter(Boolean).slice(0, 64)
          : undefined,
      });
      return json({ node }, { status: 201 });
    }

    return json({ error: "Invalid provider node type" }, { status: 400 });
  } catch (error) {
    console.log("Error creating provider node:", error);
    return json({ error: "Failed to create provider node" }, { status: 500 });
  }
}
