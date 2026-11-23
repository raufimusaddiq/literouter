import { json } from "@/server/http.js";
import { stopHeadroomProxy } from "@/lib/headroom/process";

export async function POST() {
  try {
    const result = stopHeadroomProxy();
    const status = result.stopped ? 200 : 409;
    return json({ ...result }, { status });
  } catch (error) {
    return json({ error: error.message, code: error.code || null }, { status: 500 });
  }
}
