import { ERROR_TYPES, DEFAULT_ERROR_MESSAGES, CLAUDE_ERROR_TYPES, GEMINI_ERROR_STATUS } from "../config/errorConfig.js";
import { FORMATS } from "../translator/formats.js";

export function resolveErrorFormat(pathname, sourceFormat) {
  const path = pathname || "";
  if (path.includes("/v1beta/")) return FORMATS.GEMINI;
  if (path.includes("/v1/messages")) return FORMATS.CLAUDE;
  if (sourceFormat === FORMATS.CLAUDE) return FORMATS.CLAUDE;
  if (sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI) return FORMATS.GEMINI;
  return FORMATS.OPENAI;
}

function claudeErrorType(statusCode) {
  return CLAUDE_ERROR_TYPES[statusCode] || (statusCode >= 500 ? "api_error" : "invalid_request_error");
}

function geminiErrorStatus(statusCode) {
  return GEMINI_ERROR_STATUS[statusCode] || (statusCode >= 500 ? "INTERNAL" : "INVALID_ARGUMENT");
}

export function buildErrorBody(statusCode, message, format = FORMATS.OPENAI, code = undefined) {
  const text = message || DEFAULT_ERROR_MESSAGES[statusCode] || "An error occurred";
  if (format === FORMATS.CLAUDE) {
    return { type: "error", error: { type: claudeErrorType(statusCode), message: text } };
  }
  if (format === FORMATS.GEMINI) {
    return { error: { code: statusCode, message: text, status: geminiErrorStatus(statusCode) } };
  }
  const errorInfo = ERROR_TYPES[statusCode] || 
    (statusCode >= 500 
      ? { type: "server_error", code: "internal_server_error" }
      : { type: "invalid_request_error", code: "" });

  return {
    error: {
      message: message || DEFAULT_ERROR_MESSAGES[statusCode] || "An error occurred",
      type: errorInfo.type,
      code: code ?? errorInfo.code
    }
  };
}

export function errorResponse(statusCode, message, extraHeaders = null, format = FORMATS.OPENAI, code = undefined) {
  return new Response(JSON.stringify(buildErrorBody(statusCode, message, format, code)), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders
    }
  });
}

export async function parseUpstreamError(response, executor = null) {
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }

  if (executor && typeof executor.parseError === "function") {
    try {
      const parsed = executor.parseError(response, bodyText);
      if (parsed && typeof parsed === "object") {
        const msg = parsed.message || DEFAULT_ERROR_MESSAGES[response.status] || `Upstream error: ${response.status}`;
        return { statusCode: parsed.status || response.status, message: msg, resetsAtMs: parsed.resetsAtMs };
      }
    } catch {}
  }

  let message = "";
  try {
    const json = JSON.parse(bodyText);
    message = json.error?.message || json.message || json.error || bodyText;
  } catch {
    message = bodyText;
  }

  const messageStr = typeof message === "string" ? message : JSON.stringify(message);
  const finalMessage = messageStr || DEFAULT_ERROR_MESSAGES[response.status] || `Upstream error: ${response.status}`;

  return { statusCode: response.status, message: finalMessage };
}

export function createErrorResult(statusCode, message, resetsAtMs, extraHeaders = null, format = FORMATS.OPENAI) {
  return {
    success: false,
    status: statusCode,
    error: message,
    resetsAtMs,
    response: errorResponse(statusCode, message, extraHeaders, format)
  };
}

export function unavailableResponse(statusCode, message, retryAfter, retryAfterHuman, extraHeaders = null, format = FORMATS.OPENAI) {
  const retryAfterSec = Math.max(Math.ceil((new Date(retryAfter).getTime() - Date.now()) / 1000), 1);
  const msg = `${message} (${retryAfterHuman})`;
  return new Response(
    JSON.stringify(buildErrorBody(statusCode, msg, format)),
    {
      status: statusCode,
      headers: {
        ...extraHeaders,
        "Content-Type": "application/json",
        "retry-after": String(retryAfterSec)
      }
    }
  );
}

export function formatProviderError(error, provider, model, statusCode) {
  const code = statusCode || error.code || "FETCH_FAILED";
  const message = error.message || "Unknown error";
  const causeCode = error.cause?.code;
  const causeMsg = error.cause?.message;
  const causeStr = causeCode || causeMsg ? ` (cause: ${[causeCode, causeMsg].filter(Boolean).join(": ")})` : "";
  return `[${code}]: ${message}${causeStr}`;
}

export async function reshapeErrorResponse(response, format) {
  if (!response || response.ok || format === FORMATS.OPENAI) return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("json")) return response;

  let parsed;
  try {
    parsed = JSON.parse(await response.clone().text());
  } catch {
    return response;
  }
  if (!parsed || typeof parsed !== "object") return response;
  if (format === FORMATS.CLAUDE && parsed.type === "error" && parsed.error?.type) return response;
  if (format === FORMATS.GEMINI && parsed.error && typeof parsed.error.code === "number" && parsed.error.status) return response;

  let message = parsed.error?.message ?? parsed.message ?? parsed.error;
  if (message !== undefined && typeof message !== "string") message = JSON.stringify(message);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(JSON.stringify(buildErrorBody(response.status, message, format)), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
