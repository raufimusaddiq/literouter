import { NextResponse } from "next/server";
import { getApiKeys, getApiKeyUsageRows } from "@/lib/db/index.js";
import { mapUsageToKeys } from "@/lib/keyUsage.js";
import { createTtlCache } from "@/lib/asyncLimits.js";

export const dynamic = "force-dynamic";

const usageCache = createTtlCache({ ttlMs: 30_000 });

export async function GET() {
  try {
    const [keys, rows] = await Promise.all([getApiKeys(), usageCache.get("rows", () => getApiKeyUsageRows())]);
    return NextResponse.json({ usage: mapUsageToKeys(keys, rows) });
  } catch (error) {
    console.log("Error fetching key usage:", error);
    return NextResponse.json({ error: "Failed to fetch key usage" }, { status: 500 });
  }
}
