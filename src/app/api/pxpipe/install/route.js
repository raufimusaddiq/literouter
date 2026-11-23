import { json } from "@/server/http.js";
import { installPxpipe } from "@/lib/pxpipe/install.js";
import { unloadPxpipe } from "@/lib/pxpipe/loader.js";
import { runHealthCheck } from "@/lib/pxpipe/service.js";

export async function POST() {
  try {
    const info = await installPxpipe();
    unloadPxpipe();
    const health = await runHealthCheck();
    return json({ ...info, health });
  } catch (error) {
    return json({ error: error.message, code: error.code || null }, { status: 500 });
  }
}
