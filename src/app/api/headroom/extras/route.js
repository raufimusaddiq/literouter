import { json } from "@/server/http.js";
import { findPython310, getInstalledHeadroomExtras, HEADROOM_COMPRESSION_EXTRAS } from "@/lib/headroom/detect";
import { installHeadroomExtras, uninstallHeadroomExtras, getInstallLogTail } from "@/lib/headroom/process";

export async function GET(req) {
  try {
    if (new URL(req.url).searchParams.get("log") === "1") {
      return json({ log: getInstallLogTail() });
    }
    const python = findPython310();
    const status = getInstalledHeadroomExtras(python);
    return json({
      available: HEADROOM_COMPRESSION_EXTRAS,
      ...status,
    });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const requested = Array.isArray(body?.extras) ? body.extras : [];
    const result = await installHeadroomExtras(requested);
    return json(result);
  } catch (error) {
    const status = error.code === "NOT_INSTALLED" || error.code === "NO_PYTHON" ? 400 : 500;
    return json({ error: error.message, code: error.code || null }, { status });
  }
}

export async function DELETE(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const requested = Array.isArray(body?.extras) ? body.extras : [];
    const result = await uninstallHeadroomExtras(requested);
    return json(result);
  } catch (error) {
    const status = error.code === "NO_PYTHON" || error.code === "INVALID_EXTRAS" ? 400 : 500;
    return json({ error: error.message, code: error.code || null }, { status });
  }
}
