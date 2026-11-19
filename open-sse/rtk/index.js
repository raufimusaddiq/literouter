// RTK port: compress tool_result content in LLM request bodies
// Applied in chatCore on the source-format body, before translateRequest.
import { RAW_CAP, MIN_COMPRESS_SIZE } from "./constants.js";
import { autoDetectFilter } from "./autodetect.js";
import { safeApply } from "./applyFilter.js";
import { createHash } from "node:crypto";

// Memo of compressed output per tool_result text. Conversations resend the whole
// history every turn, so unchanged results would otherwise be re-filtered each time.
// Keyed by length + sha1 (collision-safe in practice); bounded LRU by entries and bytes.
// A cached value of null means "filters produced nothing usable; keep original".
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
  memo.delete(key); memo.set(key, entry); // LRU touch
  return entry;
}

function memoSet(key, entry) {
  const size = entry.out ? entry.out.length : 0;
  memo.set(key, entry);
  memoBytes += size;
  while (memo.size > MEMO_MAX_ENTRIES || memoBytes > MEMO_MAX_BYTES) {
    const oldest = memo.keys().next().value;
    memoBytes -= memo.get(oldest).out ? memo.get(oldest).out.length : 0;
    memo.delete(oldest);
  }
}

// Compress tool_result content in-place. Returns stats or null if disabled/failed.
export function compressMessages(body, enabled) {
  if (!enabled) return null;
  if (!body) return null;

  // Kiro format: conversationState.history + conversationState.currentMessage
  if (body.conversationState) {
    return compressKiroFormat(body, enabled);
  }

  // Support both OpenAI/Claude "messages" and OpenAI Responses "input"
  const items = Array.isArray(body.messages) ? body.messages
    : Array.isArray(body.input) ? body.input
    : null;
  if (!items) return null;

  const stats = { bytesBefore: 0, bytesAfter: 0, hits: [] };
  try {
    for (let i = 0; i < items.length; i++) {
      const msg = items[i];
      if (!msg) continue;

      // Shape 4: OpenAI Responses — top-level { type:"function_call_output", output: string | [{type:"input_text", text}] }
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

      // Shape 1: OpenAI tool message — { role:"tool", content: "string" }
      if (msg.role === "tool" && typeof msg.content === "string") {
        msg.content = compressText(msg.content, stats, "openai-tool");
        continue;
      }

      if (!Array.isArray(msg.content)) continue;

      // Shape 1b: OpenAI tool message — { role:"tool", content:[{type:"text", text:"..."}] }
      if (msg.role === "tool") {
        for (let k = 0; k < msg.content.length; k++) {
          const part = msg.content[k];
          if (part && part.type === "text" && typeof part.text === "string") {
            part.text = compressText(part.text, stats, "openai-tool-array");
          }
        }
        continue;
      }

      // Shape 2/3: blocks array with tool_result entries
      for (let j = 0; j < msg.content.length; j++) {
        const block = msg.content[j];
        if (!block || block.type !== "tool_result") continue;
        if (block.is_error === true) continue; // preserve error traces

        if (typeof block.content === "string") {
          // Shape 2: claude string form
          block.content = compressText(block.content, stats, "claude-string");
        } else if (Array.isArray(block.content)) {
          // Shape 3: claude array form — compress each text part
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

// Compress Kiro format: conversationState.history[].userInputMessage.userInputMessageContext.toolResults[].content[].text
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
        if (tr.status === "error") continue; // preserve error traces
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
  } catch { /* fail-open: recompute */ }

  if (entry !== undefined) {
    rtkMemoStats.hits++;
  } else {
    rtkMemoStats.misses++;
    const fn = autoDetectFilter(text);
    const out = fn ? safeApply(fn, text) : null;
    // Safety: never return empty, never grow the input
    const usable = !!fn && !!out && out.length > 0 && out.length < bytesIn;
    entry = usable ? { out, filter: fn.filterName || fn.name } : { out: null, filter: null };
    if (key) { try { memoSet(key, entry); } catch { /* ignore */ } }
  }

  if (!entry.out) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  stats.bytesAfter += entry.out.length;
  stats.hits.push({ shape, filter: entry.filter, saved: bytesIn - entry.out.length });
  return entry.out;
}

// Convenience: format a log line from stats
export function formatRtkLog(stats) {
  if (!stats || !stats.hits || stats.hits.length === 0) return null;
  const saved = stats.bytesBefore - stats.bytesAfter;
  const pct = stats.bytesBefore > 0 ? ((saved / stats.bytesBefore) * 100).toFixed(1) : "0";
  const filters = Array.from(new Set(stats.hits.map(h => h.filter))).join(",");
  return `[RTK] saved ${saved}B / ${stats.bytesBefore}B (${pct}%) via [${filters}] hits=${stats.hits.length}`;
}
