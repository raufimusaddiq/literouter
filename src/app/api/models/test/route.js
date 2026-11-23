import { json } from "@/server/http.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { pingModelByKind } from "./ping";

export async function POST(request) {
  try {
    const { model, kind } = await request.json();
    if (!model) return json({ error: "Model required" }, { status: 400 });
    const result = await pingModelByKind(model, kind || "llm");
    const { connectionFailure, ...body } = result;
    const failureStatus = connectionFailure
      && (result.status === HTTP_STATUS.GATEWAY_TIMEOUT || result.status === HTTP_STATUS.BAD_GATEWAY)
      ? result.status
      : 200;
    return json(body, { status: result.ok ? 200 : failureStatus });
  } catch (err) {
    return json({ ok: false, error: err.message }, { status: 500 });
  }
}
