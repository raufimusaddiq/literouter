import { FORMATS } from "../translator/formats.js";
import { CLAUDE_EVENT } from "../translator/schema/index.js";

export const MAX_PRE_CONTENT_BYTES = 64 * 1024;

function isClaudeMeaningful(parsed) {
  if (parsed.type === CLAUDE_EVENT.CONTENT_BLOCK_DELTA) {
    return Boolean(parsed.delta?.text || parsed.delta?.thinking || parsed.delta?.partial_json);
  }
  if (parsed.type === CLAUDE_EVENT.CONTENT_BLOCK_START) {
    return parsed.content_block?.type === "tool_use";
  }
  if (parsed.type === CLAUDE_EVENT.MESSAGE_STOP) return true;
  if (parsed.type === CLAUDE_EVENT.MESSAGE_DELTA) {
    return Boolean(parsed.delta?.stop_reason);
  }
  return false;
}

function isResponsesMeaningful(parsed) {
  const evtType = parsed.type;
  if (typeof evtType !== "string") return false;
  return (
    evtType.endsWith(".delta") ||
    evtType === "response.output_item.added" ||
    evtType === "response.output_item.done" ||
    evtType === "response.completed" ||
    evtType === "response.incomplete" ||
    evtType === "response.failed"
  );
}

function isGeminiMeaningful(parsed) {
  const candidates = parsed.candidates || parsed.response?.candidates;
  if (!Array.isArray(candidates)) return false;
  return candidates.some((c) => {
    if (c?.finishReason) return true;
    const parts = c?.content?.parts;
    return Array.isArray(parts) && parts.some((p) => Boolean(p?.text || p?.functionCall || p?.inlineData));
  });
}

function isOpenAIMeaningful(parsed) {
  if (!Array.isArray(parsed.choices)) return false;
  return parsed.choices.some((c) => Boolean(
    c?.delta?.content ||
    c?.delta?.reasoning_content ||
    c?.delta?.reasoning ||
    (Array.isArray(c?.delta?.tool_calls) && c.delta.tool_calls.length > 0) ||
    c?.delta?.function_call ||
    c?.text ||
    c?.finish_reason,
  ));
}

function isPayloadMeaningful(parsed, sourceFormat) {
  if (!parsed || typeof parsed !== "object") return false;
  if (sourceFormat === FORMATS.CLAUDE) return isClaudeMeaningful(parsed);
  if (sourceFormat === FORMATS.OPENAI_RESPONSES) return isResponsesMeaningful(parsed);
  if (
    sourceFormat === FORMATS.GEMINI ||
    sourceFormat === FORMATS.GEMINI_CLI ||
    sourceFormat === FORMATS.ANTIGRAVITY
  ) {
    return isGeminiMeaningful(parsed);
  }
  return isOpenAIMeaningful(parsed);
}

export function hasMeaningfulSSEBytes(text, sourceFormat) {
  if (typeof text !== "string" || !text) return false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith(":") || line.startsWith("event:")) continue;
    if (sourceFormat === FORMATS.OLLAMA) {
      if (!line.startsWith("{")) continue;
      try {
        const parsed = JSON.parse(line);
        if (
          parsed.message?.content ||
          parsed.message?.thinking ||
          (Array.isArray(parsed.message?.tool_calls) && parsed.message.tool_calls.length > 0) ||
          parsed.done === true
        ) {
          return true;
        }
      } catch {
      }
      continue;
    }
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    if (payload === "[DONE]") return true;
    try {
      const parsed = JSON.parse(payload);
      if (isPayloadMeaningful(parsed, sourceFormat)) return true;
    } catch {
    }
  }
  return false;
}

export function createPrefixedStream(buffered, reader) {
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (index < buffered.length) {
        const chunk = buffered[index];
        buffered[index] = null;
        index++;
        if (index >= buffered.length) buffered.length = 0;
        controller.enqueue(chunk);
        return;
      }
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      buffered.length = 0;
      return reader.cancel(reason);
    },
  });
}

export async function waitForMeaningfulContent(
  readable,
  { sourceFormat, timeoutMs, maxWaitMs = null, signal = null, isAborted = () => false } = {},
) {
  const reader = readable.getReader();
  const startedAt = Date.now();
  if (signal?.aborted) {
    return { status: "client_aborted", reader, elapsedMs: 0, chunks: 0, bytes: 0 };
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const buffered = [];
  let bufferedBytes = 0;
  let accumulatedText = "";
  let idleTimer = null;
  let maxTimer = null;
  let onAbort = null;
  let resolveRace;

  const racePromise = new Promise((resolve) => {
    resolveRace = resolve;
  });

  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (timeoutMs > 0) {
      idleTimer = setTimeout(() => resolveRace({ kind: "timeout" }), timeoutMs);
      idleTimer.unref?.();
    }
  };

  armIdle();
  const effectiveMaxWaitMs = maxWaitMs ?? (timeoutMs > 0 ? timeoutMs * 3 : 0);
  if (effectiveMaxWaitMs > 0 && (timeoutMs <= 0 || effectiveMaxWaitMs > timeoutMs)) {
    maxTimer = setTimeout(() => resolveRace({ kind: "timeout" }), effectiveMaxWaitMs);
    maxTimer.unref?.();
  }
  if (signal) {
    onAbort = () => resolveRace({ kind: "abort" });
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    while (true) {
      if (isAborted()) {
        return { status: "pre_content_error", reader, elapsedMs: Date.now() - startedAt, chunks: buffered.length, bytes: bufferedBytes };
      }

      const step = await Promise.race([
        reader.read().then((res) => ({ kind: "read", res })),
        racePromise,
      ]);

      if (step.kind === "timeout") {
        return { status: "pre_content_stall", reader, elapsedMs: Date.now() - startedAt, chunks: buffered.length, bytes: bufferedBytes };
      }
      if (step.kind === "abort" || signal?.aborted) {
        return { status: "client_aborted", reader, elapsedMs: Date.now() - startedAt, chunks: buffered.length, bytes: bufferedBytes };
      }
      if (isAborted()) {
        return { status: "pre_content_error", reader, elapsedMs: Date.now() - startedAt, chunks: buffered.length, bytes: bufferedBytes };
      }

      const { done, value } = step.res;
      if (done) {
        return { status: "ready", stream: createPrefixedStream(buffered, reader), elapsedMs: Date.now() - startedAt };
      }

      armIdle();
      buffered.push(value);
      bufferedBytes += value?.byteLength || value?.length || 0;
      accumulatedText += decoder.decode(value, { stream: true });

      if (bufferedBytes >= MAX_PRE_CONTENT_BYTES || hasMeaningfulSSEBytes(accumulatedText, sourceFormat)) {
        return { status: "ready", stream: createPrefixedStream(buffered, reader), elapsedMs: Date.now() - startedAt };
      }
    }
  } catch {
    const elapsedMs = Date.now() - startedAt;
    return {
      status: signal?.aborted ? "client_aborted" : "pre_content_error",
      reader,
      elapsedMs,
      chunks: buffered.length,
      bytes: bufferedBytes,
    };
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    if (maxTimer) clearTimeout(maxTimer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}
