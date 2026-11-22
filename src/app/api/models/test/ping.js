import { getApiKeys } from "@/lib/localDb";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { unwrapClineEnvelope } from "open-sse/shared/clineEnvelope.js";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { HTTP_STATUS, MODEL_TEST_TIMEOUT_MS } from "open-sse/config/runtimeConfig.js";

const CLI_TOKEN_SALT = "9r-cli-auth";

async function getInternalHeaders() {
  let apiKey = null;
  try {
    const keys = await getApiKeys();
    const activeKeys = keys.filter((k) => k.isActive !== false);
    apiKey = (activeKeys.find((k) => !k.access?.restricted) || activeKeys[0])?.key || null;
  } catch {}

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  headers["x-9r-cli-token"] = await getConsistentMachineId(CLI_TOKEN_SALT);
  return headers;
}

function takeSSEEvent(buffer) {
  const payloads = [];
  let pos = 0;
  let sawBoundary = false;

  while (pos < buffer.length) {
    let end = -1;
    let terminatorLen = 0;
    for (let i = pos; i < buffer.length; i++) {
      const ch = buffer[i];
      if (ch === "\n") { end = i; terminatorLen = 1; break; }
      if (ch === "\r") {
        if (i + 1 >= buffer.length) return { payloads: null, rest: buffer };
        end = i;
        terminatorLen = buffer[i + 1] === "\n" ? 2 : 1;
        break;
      }
    }
    if (end === -1) return { payloads: null, rest: buffer };

    const line = buffer.slice(pos, end);
    pos = end + terminatorLen;

    if (line === "") {
      sawBoundary = true;
      break;
    }

    if (line.startsWith("data:")) {
      const value = line.slice(5).trim();
      if (value && value !== "[DONE]") payloads.push(value);
    }
  }

  if (!sawBoundary) {
    return { payloads: null, rest: buffer };
  }
  return { payloads, rest: buffer.slice(pos) };
}

function firstVerdict(payloads) {
  for (const payload of payloads) {
    const verdict = classifySSEPayload(payload);
    if (verdict.done) return verdict;
  }
  return null;
}

function classifySSEPayload(payload) {
  let parsed = null;
  try { parsed = JSON.parse(payload); } catch {}

  if (parsed?.error) {
    const detail = parsed.error.message || parsed.error;
    return { done: true, error: String(detail).slice(0, 240) };
  }

  const choice = parsed?.choices?.[0];
  const delta = choice?.delta || choice?.message || {};
  const hasToken = Boolean(
    String(delta.content ?? "").trim()
    || String(delta.reasoning ?? "").trim()
    || String(delta.reasoning_content ?? "").trim()
    || String(delta.thinking ?? "").trim()
    || String(delta.thinking_content ?? "").trim()
    || delta.tool_calls?.length
  );

  if (hasToken) return { done: true, ok: true };

  if (choice?.finish_reason) {
    if (choice.finish_reason === "length") return { done: true, ok: true, note: "length-limited before first token" };
    return { done: true, error: "Provider closed the stream without sending any tokens" };
  }

  return { done: false };
}

export async function pingModelByKind(model, kind, baseUrl = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`) {
  const headers = await getInternalHeaders();
  const start = Date.now();

  if (kind !== "llm") return { ok: false, status: 400, latencyMs: 0, error: "Unsupported model kind in LiteRouter" };

  const timeoutMs = MODEL_TEST_TIMEOUT_MS;
  let res;
  try {
    res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err?.name === "TimeoutError";
    return {
      ok: false,
      latencyMs: Date.now() - start,
      status: timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      connectionFailure: true,
      error: timedOut
        ? `No first token within ${timeoutMs} ms — the model may be slow, not unreachable`
        : `Could not reach the model: ${err?.message || String(err)}`,
    };
  }

  const contentType = (res.headers?.get?.("content-type") || "").toLowerCase();
  if (!res.ok || !contentType.includes("text/event-stream")) {
    const rawText = await res.text().catch(() => "");
    let parsed = null;
    try { parsed = rawText ? JSON.parse(rawText) : null; } catch {}

    const providerId = resolveProviderId(String(model).split("/")[0]);
    parsed = unwrapClineEnvelope(parsed, providerId);

    const latencyMs = Date.now() - start;

    if (!res.ok) {
      const detail = parsed?.error?.message || parsed?.msg || parsed?.message || parsed?.error || rawText;
      return { ok: false, latencyMs, error: `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 500)}` : ""}`, status: res.status };
    }

    const providerStatus = parsed?.status;
    const providerMsg = parsed?.msg || parsed?.message;
    const hasProviderErrorStatus = providerStatus !== undefined
      && providerStatus !== null
      && String(providerStatus) !== "200"
      && String(providerStatus) !== "0";
    if (hasProviderErrorStatus && providerMsg) {
      return {
        ok: false,
        latencyMs,
        status: res.status,
        error: `Provider status ${providerStatus}: ${String(providerMsg).slice(0, 240)}`,
      };
    }

    if (parsed?.error) {
      const providerError = parsed?.error?.message || parsed?.error || "Provider returned an error";
      return { ok: false, latencyMs, status: res.status, error: String(providerError).slice(0, 240) };
    }

    const hasChoices = Array.isArray(parsed?.choices) && parsed.choices.length > 0;

    const firstChoice = parsed?.choices?.[0] || {};
    const hasReasoning =
      firstChoice.message?.reasoning ||
      firstChoice.message?.reasoning_content ||
      firstChoice.message?.thinking ||
      firstChoice.message?.thinking_content;
    const contentEmpty = !String(firstChoice.message?.content || "").trim();
    if (hasChoices && firstChoice.finish_reason === "length" && contentEmpty && hasReasoning) {
      return { ok: true, latencyMs, error: null, status: res.status, note: "reasoning-only response (length-limited)" };
    }

    if (!hasChoices) {
      return {
        ok: false,
        latencyMs,
        status: res.status,
        error: "Provider returned no completion choices for this model",
      };
    }

    return { ok: true, latencyMs, error: null, status: res.status };
  }

  const reader = res.body?.getReader?.();
  if (!reader) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      status: HTTP_STATUS.BAD_GATEWAY,
      error: "Provider returned an empty stream for this model",
    };
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });

      for (;;) {
        const { payloads, rest } = takeSSEEvent(buffer);
        buffer = rest;
        if (payloads === null) break;
        const verdict = firstVerdict(payloads);
        if (!verdict) continue;
        return verdict.ok
          ? { ok: true, latencyMs: Date.now() - start, error: null, status: res.status, ...(verdict.note ? { note: verdict.note } : {}) }
          : { ok: false, latencyMs: Date.now() - start, status: res.status, error: verdict.error };
      }

      if (done) {
        buffer += decoder.decode();
        if (buffer.trim()) {
          const { payloads } = takeSSEEvent(`${buffer}\n\n`);
          const verdict = payloads === null ? null : firstVerdict(payloads);
          if (verdict) {
            return verdict.ok
              ? { ok: true, latencyMs: Date.now() - start, error: null, status: res.status, ...(verdict.note ? { note: verdict.note } : {}) }
              : { ok: false, latencyMs: Date.now() - start, status: res.status, error: verdict.error };
          }
        }
        return {
          ok: false,
          latencyMs: Date.now() - start,
          status: res.status,
          error: "Provider closed the stream without sending any tokens",
        };
      }
    }
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    return {
      ok: false,
      latencyMs: Date.now() - start,
      status: timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      connectionFailure: true,
      error: timedOut
        ? `No first token within ${timeoutMs} ms — the model may be slow, not unreachable`
        : `Could not reach the model: ${err?.message || String(err)}`,
    };
  } finally {
    try {
      const cancelled = reader.cancel?.();
      if (cancelled?.catch) cancelled.catch(() => {});
    } catch {}
  }
}
