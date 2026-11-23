import { json } from "@/server/http.js";
import { getRecentLogs } from "@/lib/usageDb";

export async function GET() {
  try {
    const logs = await getRecentLogs(200);
    return json(logs);
  } catch (error) {
    console.error("[API ERROR] /api/usage/request-logs failed:", error);
    console.error("[API ERROR] Stack:", error?.stack);
    return json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
