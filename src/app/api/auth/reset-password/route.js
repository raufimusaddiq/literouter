import { json } from "@/server/http.js";
import { updateSettings } from "@/lib/localDb";

export async function POST() {
  try {
    await updateSettings({ password: null });
    return json({ success: true });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
