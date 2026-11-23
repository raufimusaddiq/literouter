import { json } from "@/server/http.js";
import { exportDb, getSettings, importDb } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const PASSWORD_HEADER = "x-9r-password";

function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

export async function GET(request) {
  try {
    if (!isCliRequest(request) && !(await verifyDashboardPassword(request.headers.get(PASSWORD_HEADER)))) {
      return json({ error: "Invalid password" }, { status: 401 });
    }
    const payload = await exportDb();
    return json(payload);
  } catch (error) {
    console.log("Error exporting database:", error);
    return json({ error: "Failed to export database" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { password, ...payload } = await request.json();
    if (!isCliRequest(request) && !(await verifyDashboardPassword(password))) {
      return json({ error: "Invalid password" }, { status: 401 });
    }
    await importDb(payload);

    try {
      const settings = await getSettings();
      applyOutboundProxyEnv(settings);
    } catch (err) {
      console.warn("[Settings][DatabaseImport] Failed to re-apply outbound proxy env:", err);
    }

    return json({ success: true });
  } catch (error) {
    console.log("Error importing database:", error);
    return json(
      { error: error?.message || "Failed to import database" },
      { status: 400 }
    );
  }
}
