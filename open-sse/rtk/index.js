import { RAW_CAP, MIN_COMPRESS_SIZE } from "./constants.js";
import { autoDetectFilter } from "./autodetect.js";
import { safeApply } from "./applyFilter.js";
import { createHash } from "node:crypto";

const MEMO_MAX_ENTRIES = 2000;
const MEMO_MAX_BYTES = 32 * 1024 * 1024;
const memo = new Map();
let memoBytes = 0;
export const rtkMemoStats = { hits: 0, misses: 0 };

export function clearRtkMemo() { memo.clear(); memoBytes = 0; rtkMemoStats.hits = 0; rtkMemoStats.misses = 0; }

function memoKey(text) {
  return text.length + ":" + createHash("sha1").update(text).digest("base64");
}

function memoGet(key) {
  if (!memo.has(key)) return undefined;
  const entry = memo.get(key);
  memo.delete(key); memo.set(key, entry);
  return entry;
}

function memoSize(key, entry) {
  return (entry.out ? entry.out.length : 0) + String(key).length + 64;
}

function memoSet(key, entry) {
  const size = memoSize(key, entry);
  memo.set(key, entry);
  memoBytes += size;
  while (memo.size > MEMO_MAX_ENTRIES || memoBytes > MEMO_MAX_BYTES) {
    const oldest = memo.keys().next().value;
    memoBytes -= memoSize(oldest, memo.get(oldest));
    memo.delete(oldest);
  }
}

export function compressMessages(body, enabled) {
  if (!enabled) return null;
  if (!body) return null;

  if (body.conversationState) {
    return compressKiroFormat(body, enabled);
  }

  const items = Array.isArray(body.messages) ? body.messages
    : Array.isArray(body.input) ? body.input
    : null;
  if (!items) return null;

  const stats = { bytesBefore: 0, bytesAfter: 0, hits: [] };
  try {
    for (let i = 0; i < items.length; i++) {
      const msg = items[i];
      if (!msg) continue;

      if (msg.type === "function_call_output") {
        if (typeof msg.output === "string") {
          msg.output = compressText(msg.output, stats, "openai-responses-string");
        } else if (Array.isArray(msg.output)) {
          for (let k = 0; k < msg.output.length; k++) {
            const part = msg.output[k];
            if (part && part.type === "input_text" && typeof part.text === "string") {
              part.text = compressText(part.text, stats, "openai-responses-array");
            }
          }
        }
        continue;
      }

      if (msg.role === "tool" && typeof msg.content === "string") {
        msg.content = compressText(msg.content, stats, "openai-tool");
        continue;
      }

      if (!Array.isArray(msg.content)) continue;

      if (msg.role === "tool") {
        for (let k = 0; k < msg.content.length; k++) {
          const part = msg.content[k];
          if (part && part.type === "text" && typeof part.text === "string") {
            part.text = compressText(part.text, stats, "openai-tool-array");
          }
        }
        continue;
      }

      for (let j = 0; j < msg.content.length; j++) {
        const block = msg.content[j];
        if (!block || block.type !== "tool_result") continue;
        if (block.is_error === true) continue;

        if (typeof block.content === "string") {
          block.content = compressText(block.content, stats, "claude-string");
        } else if (Array.isArray(block.content)) {
          for (let k = 0; k < block.content.length; k++) {
            const part = block.content[k];
            if (part && part.type === "text" && typeof part.text === "string") {
              part.text = compressText(part.text, stats, "claude-array");
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("[RTK] compressMessages error:", e.message);
    return null;
  }
  return stats;
}

function compressKiroFormat(body, enabled) {
  const stats = { bytesBefore: 0, bytesAfter: 0, hits: [] };
  try {
    const state = body.conversationState;
    const allMessages = [...(Array.isArray(state?.history) ? state.history : [])];
    if (state?.currentMessage) allMessages.push(state.currentMessage);

    for (const msg of allMessages) {
      const toolResults = msg?.userInputMessage?.userInputMessageContext?.toolResults;
      if (!Array.isArray(toolResults)) continue;

      for (const tr of toolResults) {
        if (tr.status === "error") continue;
        if (!Array.isArray(tr.content)) continue;

        for (const part of tr.content) {
          if (part && typeof part.text === "string") {
            part.text = compressText(part.text, stats, "kiro-tool-result");
          }
        }
      }
    }
  } catch (e) {
    console.warn("[RTK] compressKiroFormat error:", e.message);
    return null;
  }
  return stats;
}

function compressText(text, stats, shape) {
  const bytesIn = text.length;
  stats.bytesBefore += bytesIn;

  if (bytesIn < MIN_COMPRESS_SIZE || bytesIn > RAW_CAP) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  let key = null;
  let entry;
  try {
    key = memoKey(text);
    entry = memoGet(key);
  } catch {}

  if (entry !== undefined) {
    rtkMemoStats.hits++;
  } else {
    rtkMemoStats.misses++;
    const fn = autoDetectFilter(text);
    const out = fn ? safeApply(fn, text) : null;
    const usable = !!fn && !!out && out.length > 0 && out.length < bytesIn;
    entry = usable ? { out, filter: fn.filterName || fn.name } : { out: null, filter: null };
    if (key) { try { memoSet(key, entry); } catch {} }
  }

  if (!entry.out) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  stats.bytesAfter += entry.out.length;
  stats.hits.push({ shape, filter: entry.filter, saved: bytesIn - entry.out.length });
  return entry.out;
}

export function formatRtkLog(stats) {
  if (!stats || !stats.hits || stats.hits.length === 0) return null;
  const saved = stats.bytesBefore - stats.bytesAfter;
  const pct = stats.bytesBefore > 0 ? ((saved / stats.bytesBefore) * 100).toFixed(1) : "0";
  const filters = Array.from(new Set(stats.hits.map(h => h.filter))).join(",");
  return `[RTK] saved ${saved}B / ${stats.bytesBefore}B (${pct}%) via [${filters}] hits=${stats.hits.length}`;
}
