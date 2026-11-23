import { json } from "@/server/http.js";
import { getSettings, updateSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { resetComboRotation } from "open-sse/services/combo.js";
import { hashPassword, verifyPassword } from "@/lib/auth/password.js";

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store"
};

const PROTECTED_SETTING_KEYS = ["password"];

export async function GET() {
  try {
    const settings = await getSettings();
    const { password, ...safeSettings } = settings;

    const enableRequestLogs = process.env.ENABLE_REQUEST_LOGS === "true";
    const minimalProfile = process.env.MINIMAL_PROFILE === "true";

    return json({
      ...safeSettings,
      enableRequestLogs,
      minimalProfile,
      hasPassword: !!password
    }, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error getting settings:", error);
    return json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();

    for (const key of PROTECTED_SETTING_KEYS) delete body[key];

    if (body.newPassword) {
      const settings = await getSettings();
      const currentHash = settings.password;

      if (currentHash) {
        if (!body.currentPassword) {
          return json({ error: "Current password required" }, { status: 400 });
        }
        const isValid = await verifyPassword(body.currentPassword, currentHash);
        if (!isValid) {
          return json({ error: "Invalid current password" }, { status: 401 });
        }
      } else {
        if (body.currentPassword && body.currentPassword !== "123456") {
           return json({ error: "Invalid current password" }, { status: 401 });
        }
      }

      body.password = await hashPassword(body.newPassword);
      delete body.newPassword;
      delete body.currentPassword;
    }

    const settings = await updateSettings(body);

    if (
      Object.prototype.hasOwnProperty.call(body, "outboundProxyEnabled") ||
      Object.prototype.hasOwnProperty.call(body, "outboundProxyUrl") ||
      Object.prototype.hasOwnProperty.call(body, "outboundNoProxy")
    ) {
      applyOutboundProxyEnv(settings);
    }

    if (
      Object.prototype.hasOwnProperty.call(body, "comboStrategy") ||
      Object.prototype.hasOwnProperty.call(body, "comboStickyRoundRobinLimit") ||
      Object.prototype.hasOwnProperty.call(body, "comboStrategies")
    ) {
      resetComboRotation();
    }

    if (
      Object.prototype.hasOwnProperty.call(body, "claudeAutoPing") ||
      Object.prototype.hasOwnProperty.call(body, "codexAutoPing")
    ) {
      import("@/shared/services/quotaAutoPing")
        .then(({ configureQuotaAutoPing }) => {
          configureQuotaAutoPing(settings);
        })
        .catch((error) => console.warn("[AutoPing] settings update failed:", error.message));
    }

    const { password, ...safeSettings } = settings;
    return json(safeSettings, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error updating settings:", error);
    return json({ error: error.message }, { status: 500 });
  }
}
