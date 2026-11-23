import { json, cookies } from "@/server/http.js";
import { clearDashboardAuthCookie } from "@/lib/auth/dashboardSession";

export async function POST(request) {
  const cookieStore = cookies(request);
  clearDashboardAuthCookie(cookieStore);
  return json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
