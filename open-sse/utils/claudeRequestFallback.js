function upstreamMessage(rawBody) {
  if (typeof rawBody !== "string") return "";
  try {
    const parsed = JSON.parse(rawBody);
    return String(parsed?.error?.message ?? parsed?.message ?? rawBody);
  } catch {
    return rawBody;
  }
}

export function adaptClaudeRequestAfterRejection(body, rawErrorBody) {
  if (!body || typeof body !== "object") return null;
  const message = upstreamMessage(rawErrorBody);
  const next = { ...body };
  let changed = false;

  if (/tool_choice/i.test(message) && /not supported for this model/i.test(message)
    && (body.tool_choice?.type === "any" || body.tool_choice?.type === "tool")) {
    next.tool_choice = { type: "auto" };
    changed = true;
  }

  if (/between_tools/.test(message) && body.thinking?.type === "disabled") {
    next.thinking = { type: "between_tools" };
    changed = true;
  }

  if (/thinking\.type\.disabled/.test(message) && /adaptive/.test(message) && body.thinking?.type === "disabled") {
    next.thinking = { type: "adaptive" };
    next.output_config = { ...(body.output_config || {}), effort: body.output_config?.effort || "low" };
    changed = true;
  }

  return changed ? next : null;
}
