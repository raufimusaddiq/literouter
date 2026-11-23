import { json } from "@/server/http.js";
import { getPxpipeStats } from "@/lib/pxpipe/events.js";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const recentLimit = Math.min(Number(searchParams.get("limit")) || 100, 500);
    return json(getPxpipeStats({ recentLimit }));
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
