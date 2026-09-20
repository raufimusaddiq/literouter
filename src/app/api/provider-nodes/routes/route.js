import { NextResponse } from "next/server";
import { getProviderNodeById } from "@/models";
import { nodeRoutes } from "@/shared/constants/compatibleNodeRoutes";

export const dynamic = "force-dynamic";

// GET /api/provider-nodes/routes?id=<nodeId> — derived native transport map
export async function GET(request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const node = await getProviderNodeById(id);
    if (!node) return NextResponse.json({ error: "Node not found" }, { status: 404 });
    return NextResponse.json({ id, routes: nodeRoutes(node) });
  } catch (error) {
    console.log("Error resolving node routes:", error);
    return NextResponse.json({ error: "Failed to resolve node routes" }, { status: 500 });
  }
}
