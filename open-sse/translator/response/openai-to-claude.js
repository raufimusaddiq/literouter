import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, CLAUDE_BLOCK, MODEL_FALLBACK, OPENAI_FINISH, CLAUDE_EVENT } from "../schema/index.js";
import { fromOpenAIFinish } from "../concerns/finishReason.js";
import { extractReasoningText } from "../concerns/reasoning.js";
import { fallbackToolCallId } from "../concerns/toolCall.js";

// Legacy "proxy_" prefix used by older request translators. Response strips it
// defensively so tool names from such turns resolve back (e.g. proxy_Read → Read
// for arg sanitization). Current request translator emits no prefix ("") — strip
// is then a no-op. Kept intentionally; do NOT couple to request's empty prefix.
const CLAUDE_OAUTH_TOOL_PREFIX = "proxy_";

// Sanitize tool call arguments to fix bad params from non-Anthropic models
function sanitizeToolArgs(toolName, argsJson) {
  try {
    const args = JSON.parse(argsJson);
    const name = toolName.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)
      ? toolName.slice(CLAUDE_OAUTH_TOOL_PREFIX.length)
      : toolName;
    if (name === "Read") sanitizeReadArgs(args);
    return JSON.stringify(args);
  } catch {
    return argsJson;
  }
}

function sanitizeReadArgs(args) {
  if (typeof args.limit === "string" && /^\d+$/.test(args.limit)) args.limit = Number(args.limit);
  if (typeof args.offset === "string" && /^-?\d+$/.test(args.offset)) args.offset = Number(args.offset);

  if (typeof args.limit === "number") {
    if (args.limit > 2000) args.limit = 2000;
    if (args.limit < 1) delete args.limit;
  }
  if (typeof args.offset === "number" && args.offset < 0) args.offset = 0;

  if ("pages" in args && !isValidPdfPagesArg(args.file_path, args.pages)) {
    delete args.pages;
  }
}

function isValidPdfPagesArg(filePath, pages) {
  return typeof filePath === "string" &&
    filePath.toLowerCase().endsWith(".pdf") &&
    typeof pages === "string" &&
    /^\d+(?:-\d+)?$/.test(pages);
}

// Helper: stop thinking block if started
function stopThinkingBlock(state, results) {
  if (!state.thinkingBlockStarted) return;
  results.push({
    type: CLAUDE_EVENT.CONTENT_BLOCK_STOP,
    index: state.thinkingBlockIndex
  });
  state.thinkingBlockStarted = false;
}

// Helper: stop text block if started
function stopTextBlock(state, results) {
  if (!state.textBlockStarted || state.textBlockClosed) return;
  state.textBlockClosed = true;
  results.push({
    type: CLAUDE_EVENT.CONTENT_BLOCK_STOP,
    index: state.textBlockIndex
  });
  state.textBlockStarted = false;
}

// Convert OpenAI stream chunk to Claude format
export function openaiToClaudeResponse(chunk, state) {
  if (!chunk) return flushClaudeStream(state);
  // A trailing usage chunk (include_usage) has no choices but is still ours to read.
  if (!chunk.choices?.[0] && !chunk.usage) return null;

  const results = [];
  const choice = chunk.choices?.[0];
  const delta = choice?.delta;

  // Track usage from OpenAI chunk if available
  if (chunk.usage && typeof chunk.usage === "object") {
    const promptTokens = typeof chunk.usage.prompt_tokens === "number" ? chunk.usage.prompt_tokens : 0;
    const outputTokens = typeof chunk.usage.completion_tokens === "number" ? chunk.usage.completion_tokens : 0;

    // Extract cache tokens from prompt_tokens_details
    const cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens;
    const cacheCreationTokens = chunk.usage.prompt_tokens_details?.cache_creation_tokens;
    const cacheReadTokens = typeof cachedTokens === "number" ? cachedTokens : 0;
    const cacheCreateTokens = typeof cacheCreationTokens === "number" ? cacheCreationTokens : 0;

    // input_tokens = prompt_tokens - cached_tokens - cache_creation_tokens
    // Because OpenAI's prompt_tokens includes all prompt-side tokens
    const inputTokens = promptTokens - cacheReadTokens - cacheCreateTokens;

    state.usage = {
      input_tokens: inputTokens,
      output_tokens: outputTokens
    };

    // Add cache_read_input_tokens if present
    if (cacheReadTokens > 0) {
      state.usage.cache_read_input_tokens = cacheReadTokens;
    }

    // Add cache_creation_input_tokens if present
    if (cacheCreateTokens > 0) {
      state.usage.cache_creation_input_tokens = cacheCreateTokens;
    }

    // Note: completion_tokens_details.reasoning_tokens is already included in output_tokens
    // No need to add separately as Claude expects total output_tokens
  }

  // Usage-only trailer: close a completion deferred at finish_reason so the
  // client gets the real counts instead of stream.js's estimate.
  if (!choice) {
    if (!state.completionPending) return null;
    const completion = [];
    emitCompletion(state, completion, state.finishReason);
    return completion;
  }

  // First chunk - ALWAYS send message_start first
  if (!state.messageStartSent) {
    state.messageStartSent = true;
    state.messageId = chunk.id?.replace("chatcmpl-", "") || `msg_${Date.now()}`;
    if (!state.messageId || state.messageId === "chat" || state.messageId.length < 8) {
      state.messageId = chunk.extend_fields?.requestId ||
        chunk.extend_fields?.traceId ||
        `msg_${Date.now()}`;
    }
    state.model = chunk.model || MODEL_FALLBACK;
    state.nextBlockIndex = 0;
    results.push({
      type: CLAUDE_EVENT.MESSAGE_START,
      message: {
        id: state.messageId,
        type: "message",
        role: ROLE.ASSISTANT,
        model: state.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    });
  }

  // Handle reasoning (thinking) across vendor shapes - GLM/DeepSeek/Qwen/MiniMax/etc.
  const reasoningContent = extractReasoningText(delta);
  if (reasoningContent) {
    stopTextBlock(state, results);

    if (!state.thinkingBlockStarted) {
      state.thinkingBlockIndex = state.nextBlockIndex++;
      state.thinkingBlockStarted = true;
      results.push({
        type: CLAUDE_EVENT.CONTENT_BLOCK_START,
        index: state.thinkingBlockIndex,
        content_block: { type: CLAUDE_BLOCK.THINKING, thinking: "" }
      });
    }

    results.push({
      type: CLAUDE_EVENT.CONTENT_BLOCK_DELTA,
      index: state.thinkingBlockIndex,
      delta: { type: "thinking_delta", thinking: reasoningContent }
    });
  }

  // Handle regular content
  if (delta?.content) {
    stopThinkingBlock(state, results);

    if (!state.textBlockStarted) {
      state.textBlockIndex = state.nextBlockIndex++;
      state.textBlockStarted = true;
      state.textBlockClosed = false;
      results.push({
        type: CLAUDE_EVENT.CONTENT_BLOCK_START,
        index: state.textBlockIndex,
        content_block: { type: CLAUDE_BLOCK.TEXT, text: "" }
      });
    }

    results.push({
      type: CLAUDE_EVENT.CONTENT_BLOCK_DELTA,
      index: state.textBlockIndex,
      delta: { type: "text_delta", text: delta.content }
    });
  }

  // Tool calls
  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      const idx = tc.index ?? 0;
      let toolInfo = state.toolCalls.get(idx);

      // Open the block once per index. GLM/fireworks repeat id+null-name on every
      // arg chunk, while other providers open the index with no id at all — mint
      // one there instead of dropping the call and its buffered arguments.
      if (!toolInfo) {
        stopThinkingBlock(state, results);
        stopTextBlock(state, results);

        const toolBlockIndex = state.nextBlockIndex++;
        toolInfo = {
          id: tc.id || fallbackToolCallId(idx),
          name: tc.function?.name || "",
          blockIndex: toolBlockIndex
        };
        state.toolCalls.set(idx, toolInfo);

        // Strip prefix from tool name for response
        let toolName = tc.function?.name || "";
        if (toolName.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)) {
          toolName = toolName.slice(CLAUDE_OAUTH_TOOL_PREFIX.length);
        }

        results.push({
          type: CLAUDE_EVENT.CONTENT_BLOCK_START,
          index: toolBlockIndex,
          content_block: {
            type: CLAUDE_BLOCK.TOOL_USE,
            id: toolInfo.id,
            name: toolName,
            input: {}
          }
        });
      }

      if (tc.function?.arguments) {
        // Buffer args instead of streaming — sanitize at finish to fix bad params
        if (!state.toolArgBuffers) state.toolArgBuffers = new Map();
        state.toolArgBuffers.set(idx, (state.toolArgBuffers.get(idx) || "") + tc.function.arguments);
      }
    }
  }

  // Finish
  if (choice.finish_reason) {
    state.finishReason = choice.finish_reason;
    closeOpenBlocks(state, results);

    // Upstreams report usage on the finish chunk itself or on a trailing chunk
    // with choices: []. Emitting message_delta now would freeze estimated usage,
    // so defer when the terminal null chunk still reaches us (direct upstream
    // OpenAI -> Claude route) and the real counts are not in yet.
    const flushReachesUs = state.targetFormat === FORMATS.OPENAI;
    if (state.usage || !flushReachesUs) {
      emitCompletion(state, results, choice.finish_reason);
    } else {
      state.completionPending = true;
    }
  }

  return results.length > 0 ? results : null;
}

// Close every open block and flush buffered tool args. Idempotent: the stream can
// be finished by a finish_reason chunk, a usage trailer, or the terminal flush.
function closeOpenBlocks(state, results) {
  stopThinkingBlock(state, results);
  stopTextBlock(state, results);

  if (!state.toolBlocksClosed) state.toolBlocksClosed = new Set();
  for (const [idx, toolInfo] of state.toolCalls || []) {
    if (state.toolBlocksClosed.has(idx)) continue;
    state.toolBlocksClosed.add(idx);

    // Emit buffered + sanitized args as single delta before stop
    const buffered = state.toolArgBuffers?.get(idx);
    if (buffered) {
      const sanitized = sanitizeToolArgs(toolInfo.name, buffered);
      results.push({
        type: CLAUDE_EVENT.CONTENT_BLOCK_DELTA,
        index: toolInfo.blockIndex,
        delta: { type: "input_json_delta", partial_json: sanitized }
      });
    }
    results.push({
      type: CLAUDE_EVENT.CONTENT_BLOCK_STOP,
      index: toolInfo.blockIndex
    });
  }
}

// message_delta + message_stop, sent once. stop_reason is derived from the
// finish_reason when upstream gave one, else from whether a tool block opened.
function emitCompletion(state, results, finishReason) {
  if (state.messageStopSent) return;
  state.messageStopSent = true;
  state.completionPending = false;

  const stopReason = finishReason
    ? convertFinishReason(finishReason)
    : (state.toolCalls?.size ? convertFinishReason(OPENAI_FINISH.TOOL_CALLS) : convertFinishReason(OPENAI_FINISH.STOP));

  results.push({
    type: CLAUDE_EVENT.MESSAGE_DELTA,
    delta: { stop_reason: stopReason },
    // Use tracked usage (will be estimated in stream.js if not valid)
    usage: state.usage || { input_tokens: 0, output_tokens: 0 }
  });
  results.push({ type: CLAUDE_EVENT.MESSAGE_STOP });
}

// Terminal flush (null chunk): a stream that ended without finish_reason still
// has to close its blocks and tell the client the message is over.
function flushClaudeStream(state) {
  if (!state?.messageStartSent || state.messageStopSent) return null;

  const results = [];
  closeOpenBlocks(state, results);
  emitCompletion(state, results, state.finishReason);
  return results;
}

const convertFinishReason = (reason) => fromOpenAIFinish(reason, "claude");

// Register
register(FORMATS.OPENAI, FORMATS.CLAUDE, null, openaiToClaudeResponse);
