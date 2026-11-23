import { json } from "@/server/http.js";
import { getSettings } from "@/lib/localDb";

export async function GET() {
  try {
    const settings = await getSettings();
    const requireLogin = settings.requireLogin !== false;
    return json({ requireLogin });
  } catch (error) {
    return json({ requireLogin: true }, { status: 200 });
  }
}
