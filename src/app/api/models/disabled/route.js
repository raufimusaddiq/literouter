import { json } from "@/server/http.js";
import { getDisabledModels, disableModels, enableModels } from "@/lib/disabledModelsDb";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerAlias = searchParams.get("providerAlias");
    const all = await getDisabledModels();
    if (providerAlias) return json({ ids: all[providerAlias] || [] });
    return json({ disabled: all });
  } catch (error) {
    console.log("Error fetching disabled models:", error);
    return json({ error: "Failed to fetch disabled models" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { providerAlias, ids } = await request.json();
    if (!providerAlias || !Array.isArray(ids)) {
      return json({ error: "providerAlias and ids[] required" }, { status: 400 });
    }
    await disableModels(providerAlias, ids);
    return json({ success: true });
  } catch (error) {
    console.log("Error disabling models:", error);
    return json({ error: "Failed to disable models" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerAlias = searchParams.get("providerAlias");
    const id = searchParams.get("id");
    if (!providerAlias) {
      return json({ error: "providerAlias required" }, { status: 400 });
    }
    await enableModels(providerAlias, id ? [id] : []);
    return json({ success: true });
  } catch (error) {
    console.log("Error enabling models:", error);
    return json({ error: "Failed to enable models" }, { status: 500 });
  }
}
