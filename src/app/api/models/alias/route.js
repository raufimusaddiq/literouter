import { json } from "@/server/http.js";
import { getModelAliases, setModelAlias, deleteModelAlias } from "@/models";

export async function GET() {
  try {
    const aliases = await getModelAliases();
    return json({ aliases });
  } catch (error) {
    console.log("Error fetching aliases:", error);
    return json({ error: "Failed to fetch aliases" }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return json({ error: "Model and alias required" }, { status: 400 });
    }

    await setModelAlias(alias, model);

    return json({ success: true, model, alias });
  } catch (error) {
    console.log("Error updating alias:", error);
    return json({ error: "Failed to update alias" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const alias = searchParams.get("alias");

    if (!alias) {
      return json({ error: "Alias required" }, { status: 400 });
    }

    await deleteModelAlias(alias);

    return json({ success: true });
  } catch (error) {
    console.log("Error deleting alias:", error);
    return json({ error: "Failed to delete alias" }, { status: 500 });
  }
}
