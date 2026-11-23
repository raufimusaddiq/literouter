import { json } from "@/server/http.js";
import { getProviderNodeById } from "@/models";
import { nodeRoutes } from "@/shared/constants/compatibleNodeRoutes";

export async function GET(request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return json({ error: "id is required" }, { status: 400 });
    const node = await getProviderNodeById(id);
    if (!node) return json({ error: "Node not found" }, { status: 404 });
    return json({ id, routes: nodeRoutes(node) });
  } catch (error) {
    console.log("Error resolving node routes:", error);
    return json({ error: "Failed to resolve node routes" }, { status: 500 });
  }
}
