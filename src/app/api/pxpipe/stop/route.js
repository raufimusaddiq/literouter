import { json } from "@/server/http.js";
import { unloadPxpipe } from "@/lib/pxpipe/loader.js";
import { getPxpipeStatus } from "@/lib/pxpipe/service.js";

export async function POST() {
  try {
    const wasLoaded = unloadPxpipe();
    return json({ stopped: wasLoaded, ...getPxpipeStatus() });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
