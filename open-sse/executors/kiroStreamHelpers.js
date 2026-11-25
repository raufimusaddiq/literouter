import { KIRO_RUNTIME_REGIONS } from "../config/kiroConstants.js";
import { isGatewayTimeout } from "../utils/requestTimeouts.js";

export const KIRO_REPAIR_BUFFER_MAX_BYTES = 8 * 1024 * 1024;
export const KIRO_SERVICE_REGIONS = {
  q: new Set(["us-east-1", "eu-central-1"]),
  runtime: KIRO_RUNTIME_REGIONS,
  codewhisperer: new Set(["us-east-1"]),
};
export const KIRO_REPAIR_HEARTBEAT_MS = 10_000;
export const KIRO_SHORT_FINAL_MAX_CHARS = 800;
export const EVENTSTREAM_MAX_MESSAGE_BYTES = 24 * 1024 * 1024;
export const EVENTSTREAM_MAX_HEADERS_BYTES = 128 * 1024;
export const KIRO_EVENT_TYPES = new Set([
  "assistantResponseEvent",
  "reasoningContentEvent",
  "codeEvent",
  "toolUseEvent",
  "messageStopEvent",
  "metadataEvent",
  "MetadataEvent",
  "contextUsageEvent",
  "meteringEvent",
  "metricsEvent",
]);
export const KIRO_TRUNCATION_STOP_REASONS = new Set(["model_context_window_exceeded", "max_tokens"]);

export const encoder = new TextEncoder();
export const decoder = new TextDecoder();

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

export const REPAIR_INSTRUCTIONS = Object.freeze({
  tool: "Retry the previous response because its Kiro tool_call wrapper was malformed. If you use the wrapper tool named tool_call, its input must contain a non-empty name and an arguments field.",
  ellipsis: "Retry the previous response because it ended with only an ellipsis. Return the complete final answer, not only ... or ….",
  short_final: "Retry the previous response because its final only announced a future action. Complete the check now and return the result or a concrete blocker.",
});

const SHORT_FUTURE_ACTION = /^(?:(?:(?:現在|接著|接下來|下一步)[，,:：\s]*(?:我(?:只)?(?:會|要|將|再)?\s*)?|我只再)(?:補|查|確認|驗證|追(?:查|蹤)?|繼續|檢查|測試)|我(?:會|要|將)(?:再|重新)?(?:補(?:齊|查)?|抓取|查(?:詢)?|確認|驗證|追(?:查|蹤)?|繼續|檢查|測試)|(?:(?:next|now|then)\b[\s,:-]*)?(?:i(?:'ll| will| am going to| need to)|let me)\s+(?:verify|check|confirm|validate|investigate|trace|continue|follow up|test)\b)/iu;
const OBSERVED_TRAILING_FUTURE_ACTION = /^目前證據顯示[\s\S]{1,700}[。.!?；;]\s*最後補查\s+504\s+access\s+log[，,]\s*確認\s+host[／/]路徑與是否為集中流量[。.!]?$/iu;
const ENGLISH_FUTURE_ACTION = /^(?:(?:next|now|then)\b[\s,:-]*)?(?:i(?:'ll| will| am going to| need to)|let me)\s+(?:verify|check|confirm|validate|investigate|trace|continue|follow up|test)\b/iu;
const ENGLISH_RESULT_CLAUSE = /(?:[:;\n]|[.!?]\s+\S|\b(?:status|checksum|response|deployment)\s+(?:is|are|was|were|matches?|equals?|returned)\b)/iu;
const CHINESE_FUTURE_ACTION = /^(?:(?:現在|接著|接下來|下一步)[，,:：\s]*(?:我(?:只)?(?:會|要|將|再)?\s*)?|我只再|我(?:會|要|將)(?:再|重新)?)(?:補|抓取|查|確認|驗證|追|繼續|檢查|測試)/u;
const CHINESE_RESULT_CLAUSE = /(?:[。！？]\s*\S|(?:版本|狀態|回應|結果|部署|校驗碼)(?:是|為|等於|顯示))/u;
const USER_WAIT = /(?:請(?:你|先)|你(?:先|需要|可以|提供|確認|批准|允許)|等待(?:你|使用者)|等你|核准|同意|授權|\b(?:after|when|once)\s+you\b|\byour\s+(?:approval|confirmation|permission|input)\b|\bwait(?:ing)?\s+for\s+you\b|\bplease\s+(?:approve|confirm|provide|send)\b)/iu;
const COMPLETED_FINAL = /(?:已(?:經)?完成|完成(?:了|驗證|確認)|修復完成|確認無誤|驗證(?:完成|通過)|測試(?:均)?通過|結論|總結|\b(?:done|completed|fixed|verified|confirmed|passed|in conclusion|summary)\b|\b(?:is|are) complete\b)/iu;
const RESULT_EVIDENCE = /(?:顯示|發現|因此|成功|失敗|正常|無錯誤|沒有錯誤|\b(?:found|shows?|showed|because|therefore|succeeded|failed|healthy|green|no errors?)\b)/iu;

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function envPositiveInt(name, fallback) {
  const parsed = Number.parseInt(process.env?.[name] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function concatChunks(chunks, totalBytes) {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function makeAbortError(reason) {
  if (isGatewayTimeout(reason)) return reason;
  const error = new Error(reason?.message || reason || "Request aborted");
  error.name = "AbortError";
  return error;
}

export async function readWithTimeout(reader, signal, timeoutMs, message) {
  if (signal?.aborted) throw makeAbortError(signal.reason);
  let timeout;
  let abortHandler;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  const abortPromise = new Promise((_, reject) => {
    abortHandler = () => reject(makeAbortError(signal.reason));
    signal?.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    return await Promise.race([reader.read(), timeoutPromise, abortPromise]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", abortHandler);
  }
}

export async function readResponsePrefix(response, signal, maxBytes, timeoutMs) {
  const reader = response?.body?.getReader?.();
  if (!reader) return "";
  const chunks = [];
  let totalBytes = 0;
  try {
    while (totalBytes < maxBytes) {
      const { done, value } = await readWithTimeout(
        reader,
        signal,
        timeoutMs,
        "Kiro retry error body stalled"
      );
      if (done) break;
      const remaining = maxBytes - totalBytes;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      totalBytes += chunk.byteLength;
      if (value.byteLength > remaining) break;
    }
  } finally {
    await reader.cancel("bounded Kiro retry error body").catch(() => {});
  }
  return decoder.decode(concatChunks(chunks, totalBytes));
}

export function appendRepairInstruction(body, kind) {
  const repaired = structuredClone(body || {});
  const instruction = REPAIR_INSTRUCTIONS[kind] || "Retry the previous incomplete Kiro response.";
  const msg = repaired?.conversationState?.currentMessage?.userInputMessage;
  if (msg) {
    const content = typeof msg.content === "string" ? msg.content : "";
    msg.content = content ? `${content}\n\n${instruction}` : instruction;
  }
  return repaired;
}

export function normalizeStopReason(value) {
  const reason = String(value || "").trim().replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase().replace(/[\s-]+/g, "_");
  if (["endturn", "end_turn", "stop", "stop_sequence"].includes(reason)) return "end_turn";
  if (["tooluse", "tool_use", "tool_calls"].includes(reason)) return "tool_use";
  if (["maxtokens", "max_tokens", "max_output_tokens", "length"].includes(reason)) return "max_tokens";
  return reason || null;
}

export function stopDisposition(stopReason, hasToolCalls) {
  if (["malformed_model_output", "invalid_model_output"].includes(stopReason)) return "retryable_protocol_failure";
  if (["cancelled", "pause_turn", "model_context_window_exceeded"].includes(stopReason)) return "terminal_incomplete";
  if (stopReason === "refusal" || /(?:content.*filter|guardrail|safety|policy|blocked)/u.test(stopReason)) return "terminal_refusal";
  if (stopReason === "max_tokens") return hasToolCalls ? "terminal_incomplete" : "length";
  if (stopReason && !["end_turn", "tool_use"].includes(stopReason)) return "unknown_failure";
  if (hasToolCalls || stopReason === "tool_use") return "tool_use";
  if (!stopReason || stopReason === "end_turn") return "complete";
  return "unknown_failure";
}

export function mergeStopReason(current, incoming) {
  if (!incoming) return current;
  if (!current) return incoming;
  const severity = (reason) => {
    const disposition = stopDisposition(reason, false);
    if (disposition === "terminal_refusal") return 6;
    if (disposition === "terminal_incomplete") return 5;
    if (disposition === "unknown_failure") return 4;
    if (disposition === "retryable_protocol_failure") return 3;
    if (disposition === "length") return 2;
    return 1;
  };
  return severity(incoming) > severity(current) ? incoming : current;
}

export function isEllipsisOnly(value) {
  return ["...", "…"].includes(String(value || "").trim());
}

export function isShortFutureAction(value) {
  const text = String(value || "").trim().replaceAll("’", "'");
  if (OBSERVED_TRAILING_FUTURE_ACTION.test(text)) return true;
  if (ENGLISH_FUTURE_ACTION.test(text) && ENGLISH_RESULT_CLAUSE.test(text)) return false;
  if (CHINESE_FUTURE_ACTION.test(text) && CHINESE_RESULT_CLAUSE.test(text)) return false;
  return text.length > 0 && text.length <= KIRO_SHORT_FINAL_MAX_CHARS &&
    SHORT_FUTURE_ACTION.test(text) && !USER_WAIT.test(text) &&
    !COMPLETED_FINAL.test(text) && !RESULT_EVIDENCE.test(text);
}

export function encodeSSEError(code, message, details) {
  return encoder.encode(`data: ${JSON.stringify({ error: {
    message,
    type: "upstream_error",
    code,
    ...(details ? { details } : {})
  } })}\n\ndata: [DONE]\n\n`);
}

export function inspectSSEChunk(chunk, state) {
  for (const line of decoder.decode(chunk).split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const event = JSON.parse(data);
      if (event.error) state.error = event.error;
      for (const choice of event.choices || []) {
        const delta = choice.delta || {};
        if (typeof delta.content === "string") state.content += delta.content;
        if (typeof delta.reasoning_content === "string") state.reasoning += delta.reasoning_content;
        if (delta.tool_calls?.length) state.hasToolCalls = true;
      }
    } catch {}
  }
}

export function parseEventFrame(data) {
  if (!(data instanceof Uint8Array) || data.byteLength < 16) {
    throw new Error("AWS EventStream frame is shorter than 16 bytes");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const totalLength = view.getUint32(0, false);
  const headersLength = view.getUint32(4, false);
  if (totalLength !== data.byteLength) {
    throw new Error("AWS EventStream frame length does not match its prelude");
  }
  if (totalLength > EVENTSTREAM_MAX_MESSAGE_BYTES ||
      headersLength > EVENTSTREAM_MAX_HEADERS_BYTES ||
      headersLength > totalLength - 16) {
    throw new Error("AWS EventStream frame bounds are invalid");
  }
  if (view.getUint32(8, false) !== crc32(data.subarray(0, 8))) {
    throw new Error("AWS EventStream prelude CRC mismatch");
  }
  if (view.getUint32(totalLength - 4, false) !== crc32(data.subarray(0, totalLength - 4))) {
    throw new Error("AWS EventStream message CRC mismatch");
  }

  const headers = Object.create(null);
  const names = new Set();
  let offset = 12;
  const headerEnd = offset + headersLength;
  const requireBytes = (count) => {
    if (offset + count > headerEnd) {
      throw new Error("AWS EventStream header exceeds its declared bounds");
    }
  };

  while (offset < headerEnd) {
    requireBytes(1);
    const nameLength = data[offset++];
    requireBytes(nameLength + 1);
    const name = decoder.decode(data.subarray(offset, offset + nameLength));
    offset += nameLength;
    if (names.has(name)) throw new Error(`AWS EventStream contains duplicate header: ${name}`);
    names.add(name);
    const type = data[offset++];

    if (type === 0 || type === 1) {
      headers[name] = type === 0;
    } else if (type === 2) {
      requireBytes(1);
      headers[name] = view.getInt8(offset);
      offset += 1;
    } else if (type === 3) {
      requireBytes(2);
      headers[name] = view.getInt16(offset, false);
      offset += 2;
    } else if (type === 4) {
      requireBytes(4);
      headers[name] = view.getInt32(offset, false);
      offset += 4;
    } else if (type === 5 || type === 8) {
      requireBytes(8);
      offset += 8;
    } else if (type === 6 || type === 7) {
      requireBytes(2);
      const valueLength = view.getUint16(offset, false);
      offset += 2;
      requireBytes(valueLength);
      const bytes = data.subarray(offset, offset + valueLength);
      headers[name] = type === 7 ? decoder.decode(bytes) : bytes;
      offset += valueLength;
    } else if (type === 9) {
      requireBytes(16);
      offset += 16;
    } else {
      throw new Error(`AWS EventStream header ${name} has unknown type ${type}`);
    }
  }

  const payloadBytes = data.subarray(headerEnd, totalLength - 4);
  if (payloadBytes.byteLength === 0) return { headers, payload: null };
  const payloadText = decoder.decode(payloadBytes);
  if (!payloadText.trim()) return { headers, payload: null };
  try {
    return { headers, payload: JSON.parse(payloadText) };
  } catch (error) {
    throw new Error(`AWS EventStream payload is not valid JSON (${error.message})`);
  }
}
