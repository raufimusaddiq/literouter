import { json } from "@/server/http.js";
import { unloadPxpipe, loadPxpipe } from "@/lib/pxpipe/loader.js";
import { getPxpipeStatus } from "@/lib/pxpipe/service.js";

export async function POST() {
  try {
    unloadPxpipe();
    await loadPxpipe();
    return json(getPxpipeStatus());
  } catch (error) {
    return json({ error: error.message, code: error.code || null }, { status: 500 });
  }
}
