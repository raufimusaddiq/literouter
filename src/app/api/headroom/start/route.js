import { json } from "@/server/http.js";
import { getSettings } from "@/lib/localDb";
import { startHeadroomProxy } from "@/lib/headroom/process";
import { DEFAULT_HEADROOM_URL, isLoopbackHeadroomUrl } from "@/lib/headroom/detect";

function parsePortFromUrl(url) {
  try {
    const u = new URL(url);
    const p = parseInt(u.port, 10);
    if (p > 0 && p < 65536) return p;
  } catch {}
  return null;
}

export async function POST() {
  try {
    const settings = await getSettings();
    const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
    if (!isLoopbackHeadroomUrl(url)) {
      return json({ error: "External Headroom proxies must be started outside LiteRouter", code: "EXTERNAL_PROXY" }, { status: 400 });
    }
    const port = parsePortFromUrl(url) || 8787;
    const result = await startHeadroomProxy({
      port,
      codeAware: settings.headroomCodeAware === true,
      kompress: settings.headroomKompress !== false,
    });
    return json({ success: true, ...result });
  } catch (error) {
    const status = error.code === "NOT_INSTALLED" ? 400 : 500;
    return json({ error: error.message, code: error.code || null }, { status });
  }
}
