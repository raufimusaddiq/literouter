import { json } from "@/server/http.js";
import { getUsageStats } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return json({ error: "Invalid period" }, { status: 400 });
    }

    const stats = await getUsageStats(period);
    return json(stats);
  } catch (error) {
    console.error("[API] Failed to get usage stats:", error);
    return json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}
