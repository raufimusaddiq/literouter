import { json } from "@/server/http.js";
import { getModelAliases, setModelAlias, getCustomModels } from "@/models";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { AI_MODELS } from "@/shared/constants/config";
import { getProviderAlias } from "@/shared/constants/providers";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

function revalidated(request, body) {
  const text = JSON.stringify(body);
  const etag = `"${Bun.hash(text).toString(36)}"`;
  const headers = { etag, "cache-control": "private, no-cache" };
  const sent = (request?.headers.get("if-none-match") || "").split(",").map((tag) => tag.trim().replace(/^W\//, ""));
  if (sent.includes(etag)) return new Response(null, { status: 304, headers });
  return new Response(text, { headers: { ...headers, "content-type": "application/json" } });
}

export async function GET(request) {
  try {
    const modelAliases = await getModelAliases();
    const disabled = await getDisabledModels();

    const models = AI_MODELS
      .filter((m) => {
        const alias = getProviderAlias(m.provider) || m.provider;
        const list = disabled[alias] || disabled[m.provider] || [];
        return !list.includes(m.model);
      })
      .map((m) => {
        const fullModel = `${m.provider}/${m.model}`;
        const providerAlias = getProviderAlias(m.provider) || m.provider;
        const routedModel = `${providerAlias}/${m.model}`;
        const c = getCapabilitiesForModel(m.provider, m.model);
        return {
          ...m,
          fullModel,
          routedModel,
          alias: modelAliases[fullModel] || m.model,
          caps: {
            vision: c.vision,
            search: c.search,
            reasoning: c.reasoning,
            contextWindow: c.contextWindow,
            maxOutput: c.maxOutput,
          },
        };
      });

    const seenFull = new Set(models.map((m) => m.fullModel));
    const customModels = (await getCustomModels()).filter((m) => {
      if (!m?.id || (m.kind || m.type || "llm") !== "llm") return false;
      return !seenFull.has(`${m.providerAlias}/${m.id}`);
    });
    for (const m of customModels) {
      const fullModel = `${m.providerAlias}/${m.id}`;
      const c = getCapabilitiesForModel(m.providerAlias, m.id);
      models.push({
        provider: m.providerAlias,
        model: m.id,
        name: m.name || m.id,
        fullModel,
        routedModel: fullModel,
        alias: modelAliases[fullModel] || m.id,
        caps: {
          vision: c.vision,
          search: c.search,
          reasoning: c.reasoning,
          contextWindow: c.contextWindow,
          maxOutput: c.maxOutput,
          ...(m.caps || {}),
        },
      });
    }

    return revalidated(request, { models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return json({ error: "Failed to fetch models" }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return json({ error: "Model and alias required" }, { status: 400 });
    }

    const modelAliases = await getModelAliases();

    const existingModel = Object.entries(modelAliases).find(
      ([key, val]) => val === alias && key !== model
    );

    if (existingModel) {
      return json({ error: "Alias already in use" }, { status: 400 });
    }

    await setModelAlias(model, alias);

    return json({ success: true, model, alias });
  } catch (error) {
    console.log("Error updating alias:", error);
    return json({ error: "Failed to update alias" }, { status: 500 });
  }
}
