import { json } from "@/server/http.js";
import { getSettings } from "@/lib/localDb";
import { getInstallInfo, installPxpipe } from "@/lib/pxpipe/install.js";
import { loadPxpipe } from "@/lib/pxpipe/loader.js";
import { getPxpipeStatus } from "@/lib/pxpipe/service.js";

export async function POST() {
  try {
    if (!getInstallInfo().installed) {
      const settings = await getSettings();
      if (!settings.pxpipeAutoInstall) {
        return json({ error: "PXPIPE is not installed", code: "NOT_INSTALLED" }, { status: 409 });
      }
      await installPxpipe();
    }
    await loadPxpipe();
    return json(getPxpipeStatus());
  } catch (error) {
    return json({ error: error.message, code: error.code || null }, { status: 500 });
  }
}
