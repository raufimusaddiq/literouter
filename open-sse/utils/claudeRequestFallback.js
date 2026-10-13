// Some Claude models reject request options other models accept. Rather than
// keep a per-model table, adapt the request once when Anthropic says so.
function upstreamMessage(rawBody) {
  if (typeof rawBody !== "string") return "";
  try {
    const parsed = JSON.parse(rawBody);
    return String(parsed?.error?.message ?? parsed?.message ?? rawBody);
  } catch {
    return rawBody;
  }
}

/**
 * @param {object} body Claude Messages request that was rejected with HTTP 400
 * @param {string} rawErrorBody upstream error body
 * @returns {object|null} adjusted copy to retry once, or null when nothing applies
 */
export function adaptClaudeRequestAfterRejection(body, rawErrorBody) {
  if (!body || typeof body !== "object") return null;
  const message = upstreamMessage(rawErrorBody);
  const next = { ...body };
  let changed = false;

  // "tool_choice: type "tool" and "any" are not supported for this model."
  if (/tool_choice/i.test(message) && /not supported for this model/i.test(message)
    && (body.tool_choice?.type === "any" || body.tool_choice?.type === "tool")) {
    next.tool_choice = { type: "auto" };
    changed = true;
  }

  // "To turn thinking off on this model, send "thinking": {"type": "between_tools"} ..."
  if (/between_tools/.test(message) && body.thinking?.type === "disabled") {
    next.thinking = { type: "between_tools" };
    changed = true;
  }

  // ""thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive"
  // and "output_config.effort" to control thinking behavior." — keep thinking minimal instead.
  if (/thinking\.type\.disabled/.test(message) && /adaptive/.test(message) && body.thinking?.type === "disabled") {
    next.thinking = { type: "adaptive" };
    next.output_config = { ...(body.output_config || {}), effort: body.output_config?.effort || "low" };
    changed = true;
  }

  return changed ? next : null;
}
