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
    // Prefer an unrestricted key so a dashboard model test is not refused just
    // because the first key happens to be restricted.
    const activeKeys = keys.filter((k) => k.isActive !== false);
    apiKey = (activeKeys.find((k) => !k.access?.restricted) || activeKeys[0])?.key || null;
  } catch {}

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  headers["x-9r-cli-token"] = await getConsistentMachineId(CLI_TOKEN_SALT);
  return headers;
}

/**
 * Pull one complete SSE event out of the accumulated buffer.
 *
 * Handles LF, CRLF and lone-CR line endings. A CR sitting at the very end of the
 * buffer is held back, because it may be the first half of a CRLF pair split
 * across two chunks — treating it as a terminator would corrupt the boundary.
 *
 * Returns every non-empty `data:` payload in the event, or null while no
 * complete event is available. Payloads are returned separately rather than
 * joined: OpenAI-style streams put one complete JSON object on each `data:`
 * line, and an event can carry several (an empty delta followed by one with the
 * token), so each must be classified on its own.
 *
 * `rest` is only advanced past a dispatched event, so a payload that arrived
 * without its terminating blank line is never dropped.
 */
function takeSSEEvent(buffer) {
  const payloads = [];
  let pos = 0;
  let sawBoundary = false;

  while (pos < buffer.length) {
    // Locate this line's terminator: "\n", "\r\n" or a lone "\r".
    let end = -1;
    let terminatorLen = 0;
    for (let i = pos; i < buffer.length; i++) {
      const ch = buffer[i];
      if (ch === "\n") { end = i; terminatorLen = 1; break; }
      if (ch === "\r") {
        if (i + 1 >= buffer.length) return { payloads: null, rest: buffer }; // CR may be half of a CRLF
        end = i;
        terminatorLen = buffer[i + 1] === "\n" ? 2 : 1;
        break;
      }
    }
    if (end === -1) return { payloads: null, rest: buffer }; // no complete line yet

    const line = buffer.slice(pos, end);
    pos = end + terminatorLen;

    if (line === "") {
      // Blank line: the event is complete.
      sawBoundary = true;
      break;
    }

    if (line.startsWith("data:")) {
      const value = line.slice(5).trim();
      // [DONE] and empty data lines carry no payload.
      if (value && value !== "[DONE]") payloads.push(value);
    }
  }

  if (!sawBoundary) {
    // Nothing dispatched: hand the buffer back untouched so no payload is lost.
    return { payloads: null, rest: buffer };
  }
  return { payloads, rest: buffer.slice(pos) };
}

/**
 * Classify an event's payloads in order and return the first terminal verdict,
 * or null when the event carried no usable verdict yet.
 */
function firstVerdict(payloads) {
  for (const payload of payloads) {
    const verdict = classifySSEPayload(payload);
    if (verdict.done) return verdict;
  }
  return null;
}

/**
 * Interpret one SSE payload from the first-token probe.
 * `done: true` means the stream ended without ever producing a token, which is
 * a real failure (the model answered with nothing), not a slow model.
 */
function classifySSEPayload(payload) {
  let parsed = null;
  try { parsed = JSON.parse(payload); } catch {}

  // An error frame can arrive inside an HTTP 200 stream (the router emits one
  // when a stream aborts after headers were already sent). Surface it verbatim
  // rather than reporting a bogus success.
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

  // Token first: a provider may deliver content and its terminal finish_reason
  // in the same event, and that is a success, not an empty stream.
  if (hasToken) return { done: true, ok: true };

  // Terminal frame with no token anywhere in the stream: the model produced no
  // output at all. A reasoning model that spent its whole budget is still a
  // successful connection (issue #3010), so a length-limited terminal frame
  // counts as reachable.
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

  // Reachability probe: stream and stop at the first token. Waiting for a whole
  // generation made the verdict a race against the model's full latency, so a
  // healthy-but-slow model failed while the upstream call still completed and
  // was billed. Time-to-first-token is what "is this model reachable" means.
  const timeoutMs = MODEL_TEST_TIMEOUT_MS;
  let res;
  try {
    res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        // Reasoning models spend their budget on chain-of-thought before the
        // first visible token; a tiny cap starves them and yields a false
        // failure. See issue #3010.
        max_tokens: 1024,
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Slow and unreachable are different answers. A timeout means the model did
    // not answer inside the budget, which the dashboard must not present as a
    // broken model, and must not surface as a raw DOMException.
    const timedOut = err?.name === "TimeoutError";
    return {
      ok: false,
      latencyMs: Date.now() - start,
      status: timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      // Distinguishes "the probe could not reach the model" from an upstream that
      // itself answered 502/504, so the route only re-labels its own failures.
      connectionFailure: true,
      error: timedOut
        ? `No first token within ${timeoutMs} ms — the model may be slow, not unreachable`
        : `Could not reach the model: ${err?.message || String(err)}`,
    };
  }

  // A non-SSE body means the router answered without streaming (non-streaming
  // fallback or a refusal): parse it as JSON so the caller still gets the
  // provider's real error message and the #3010 choice checks.
  const contentType = (res.headers?.get?.("content-type") || "").toLowerCase();
  if (!res.ok || !contentType.includes("text/event-stream")) {
    const rawText = await res.text().catch(() => "");
    let parsed = null;
    try { parsed = rawText ? JSON.parse(rawText) : null; } catch {}

    // Unwrap before the choices checks below. No-op for providers that do not
    // opt in via transport.quirks.clineEnvelope.
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

    // Soft-pass (issue #3010): a reasoning model may burn its whole budget on
    // chain-of-thought and return finish_reason:"length" with empty content but
    // non-empty reasoning/thinking. That's a successful connection, not a failure.
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

  // Read until the first token, then cancel immediately: the rest of the
  // generation is not consumed and must not be paid for.
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
        // Flush a trailing event that arrived without its blank-line terminator,
        // and any multi-byte character split across the last chunk.
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
    // The reader aborts on the same budget as the fetch. Treat that as the slow
    // case, not as an unreachable provider.
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
    // Stop the upstream generation as soon as we have our answer. A reader that
    // already errored or closed may reject here; that must not mask the verdict.
    try {
      const cancelled = reader.cancel?.();
      if (cancelled?.catch) cancelled.catch(() => {});
    } catch {}
  }
}
