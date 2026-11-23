import { json } from "@/server/http.js";
import { runHealthCheck } from "@/lib/pxpipe/service.js";

export async function POST() {
  try {
    const result = await runHealthCheck();
    return json(result);
  } catch (error) {
    return json({ healthy: false, checks: [], error: error.message }, { status: 500 });
  }
}

export const GET = POST;
