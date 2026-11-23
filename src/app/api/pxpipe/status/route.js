import { json } from "@/server/http.js";
import { getSettings } from "@/lib/localDb";
import { getPxpipeStatus } from "@/lib/pxpipe/service.js";

export async function GET() {
  try {
    const settings = await getSettings();
    const status = getPxpipeStatus();
    return json({
      ...status,
      enabled: !!settings.pxpipeEnabled,
      autoInstall: !!settings.pxpipeAutoInstall,
      minChars: settings.pxpipeMinChars,
      timeoutMs: settings.pxpipeTimeoutMs,
    });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
