import { json, cookies } from "@/server/http.js";
import { getSettings } from "@/lib/localDb";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";

export async function GET(request) {
  try {
    const settings = await getSettings();
    const cookieStore = cookies(request);
    const session = await getDashboardAuthSession(cookieStore.get("auth_token"));
    return json({
      requireLogin: settings.requireLogin !== false,
      hasPassword: !!settings.password,
      authenticated: !!session,
    });
  } catch {
    return json({ requireLogin: true, hasPassword: false, authenticated: false });
  }
}
