import { json } from "@/server/http.js";
import { getApiKeys, getApiKeyUsageRows } from "@/lib/db/index.js";
import { mapUsageToKeys } from "@/lib/keyUsage.js";
import { createTtlCache } from "@/lib/asyncLimits.js";

const usageCache = createTtlCache({ ttlMs: 30_000 });

export async function GET() {
  try {
    const [keys, rows] = await Promise.all([getApiKeys(), usageCache.get("rows", () => getApiKeyUsageRows())]);
    return json({ usage: mapUsageToKeys(keys, rows) });
  } catch (error) {
    console.log("Error fetching key usage:", error);
    return json({ error: "Failed to fetch key usage" }, { status: 500 });
  }
}
