import { NextResponse } from "next/server";
import { getApiKeys, getApiKeyUsageRows } from "@/lib/db/index.js";
import { mapUsageToKeys } from "@/lib/keyUsage.js";

export const dynamic = "force-dynamic";

// GET /api/usage/keys - { usage: { [keyId]: { requests24h, lastUsed } } }.
// Guarded by the dashboard session like /api/keys; never returns raw keys.
export async function GET() {
  try {
    const [keys, rows] = await Promise.all([getApiKeys(), getApiKeyUsageRows()]);
    return NextResponse.json({ usage: mapUsageToKeys(keys, rows) });
  } catch (error) {
    console.log("Error fetching key usage:", error);
    return NextResponse.json({ error: "Failed to fetch key usage" }, { status: 500 });
  }
}
