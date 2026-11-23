import { json } from "@/server/http.js";
import { getCustomModels, addCustomModel, deleteCustomModel } from "@/models";
import { CAPACITY_META } from "@/shared/constants/models";

function sanitizeCaps(caps) {
  if (!caps || typeof caps !== "object") return null;
  const clean = {};
  for (const key of Object.keys(CAPACITY_META)) {
    if (typeof caps[key] === "boolean") clean[key] = caps[key];
  }
  return Object.keys(clean).length ? clean : null;
}

export async function GET() {
  try {
    const models = await getCustomModels();
    return json({ models });
  } catch (error) {
    console.log("Error fetching custom models:", error);
    return json({ error: "Failed to fetch custom models" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { providerAlias, id, type, name, caps } = await request.json();
    if (!providerAlias || !id) {
      return json({ error: "providerAlias and id required" }, { status: 400 });
    }
    const cleanCaps = sanitizeCaps(caps);
    const added = await addCustomModel({ providerAlias, id, type: type || "llm", name, ...(cleanCaps ? { caps: cleanCaps } : {}) });
    return json({ success: true, added });
  } catch (error) {
    console.log("Error adding custom model:", error);
    return json({ error: "Failed to add custom model" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerAlias = searchParams.get("providerAlias");
    const id = searchParams.get("id");
    const type = searchParams.get("type") || "llm";
    if (!providerAlias || !id) {
      return json({ error: "providerAlias and id required" }, { status: 400 });
    }
    await deleteCustomModel({ providerAlias, id, type });
    return json({ success: true });
  } catch (error) {
    console.log("Error deleting custom model:", error);
    return json({ error: "Failed to delete custom model" }, { status: 500 });
  }
}
