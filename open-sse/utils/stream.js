import { translateResponse, initState } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { PENDING_COMPLETION_FLUSH_MS, TRANSLATE_HEARTBEAT_MS } from "../config/runtimeConfig.js";
import { PROVIDERS } from "../config/providers.js";
import { liftReasoningAliases } from "../translator/concerns/reasoning.js";
import { trackPendingRequest } from "@/lib/usageDb.js";
import { extractUsage, mergeUsage, hasValidUsage, estimateUsage, estimateInputTokens, estimateOutputTokens, formatUsage, logUsage, filterUsageForFormat, COLORS } from "./usageTracking.js";
import { parseSSELine, hasValuableContent, fixInvalidId, formatSSE, formatResponsesPassthroughSSE, ensureStreamToolCallIds } from "./streamHelpers.js";
import { restoreToolNames } from "./opencodeFingerprint.js";
import { getOpenAIResponsesEventName, isOpenAIResponsesTerminalEvent, formatIncompleteOpenAIResponsesStreamFailure } from "./responsesStreamHelpers.js";
import { dbg, isDebugEnabled } from "./debugLog.js";

import { SSE_DONE, SSE_HEADERS, SSE_HEADERS_NO_BUFFER } from "./sseConstants.js";
import { CLAUDE_EVENT } from "../translator/schema/index.js";

export { COLORS, formatSSE };
export { SSE_DONE, SSE_HEADERS, SSE_HEADERS_NO_BUFFER };

const sharedEncoder = new TextEncoder();

const MAX_ACCUMULATED_CHARS = 5 * 1024;

function createAccumulator(cap = MAX_ACCUMULATED_CHARS) {
  const half = Math.floor(cap / 2);
  let head = "";
  let tail = "";
  let omitted = 0;
  return {
    add(text) {
      if (head.length < half) {
        const room = half - head.length;
        head += text.slice(0, room);
        text = text.slice(room);
      }
      if (!text) return;
      tail += text;
      if (tail.length > half) {
        omitted += tail.length - half;
        tail = tail.slice(-half);
      }
    },
    toString() {
      return omitted ? `${head}\n...[${omitted} chars omitted]...\n${tail}` : head + tail;
    }
  };
}

const STREAM_MODE = {
  TRANSLATE: "translate",
  PASSTHROUGH: "passthrough"
};

export function createSSEStream(options = {}) {
  const {
    mode = STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat,
    provider = null,
    reqLogger = null,
    toolNameMap = null,
    customToolNames = null,
    model = null,
    connectionId = null,
    body = null,
    onStreamComplete = null,
    apiKey = null,
    credentials = null,
    rewriteEvent = null
  } = options;

  let buffer = "";
  let usage = null;

  const seenToolCallIds = new Map();

  const decoder = new TextDecoder("utf-8", { fatal: false });

  const state = mode === STREAM_MODE.TRANSLATE
    ? { ...initState(sourceFormat), provider, toolNameMap, customToolNames: new Set(customToolNames || []), model, sessionId: credentials?._clientSessionId || null,
        targetFormat }
    : null;

  let totalContentLength = 0;
  const accumulatedContent = createAccumulator();
  const accumulatedThinking = createAccumulator();
  let inputEstimate = null;
  const getInputEstimate = () => (inputEstimate ??= estimateInputTokens(body));
  const estimateStreamUsage = (format) => {
    const usageFormat = format === FORMATS.CLAUDE ? FORMATS.CLAUDE : FORMATS.OPENAI;
    return formatUsage(getInputEstimate(), estimateOutputTokens(totalContentLength), usageFormat);
  };
  const includeUsage = body?.stream_options?.include_usage === true;
  let clientUsageSent = false;
  let sawTerminal = false;
  let pendingReleased = false;
  let responseMeta = { id: null, model: null, created: null };
  let ttftAt = null;
  let sseLineCount = 0;
  let sseEmittedCount = 0;
  const eventTypeCounts = {};

  let currentOpenAIResponsesEvent = null;
  let openAIResponsesTerminalSeen = false;
  let openAIResponsesDoneSent = false;
  let streamDoneSent = false;
  let translatedDoneEmitted = false;
  let finalized = false;
  let completionFlushTimer = null;

  const liftAliases = mode === STREAM_MODE.PASSTHROUGH && !!PROVIDERS[provider]?.quirks?.reasoningAliasFields;

  let lastHeartbeatAt = 0;
  const emitHeartbeat = (controller) => {
    const now = Date.now();
    if (now - lastHeartbeatAt < TRANSLATE_HEARTBEAT_MS) return;
    lastHeartbeatAt = now;
    controller.enqueue(sharedEncoder.encode(
      sourceFormat === FORMATS.CLAUDE ? 'event: ping\ndata: {"type":"ping"}\n\n' : ": keepalive\n\n"
    ));
  };

  const finalizeStream = (extra) => {
    if (completionFlushTimer) { clearTimeout(completionFlushTimer); completionFlushTimer = null; }
    if (finalized) return;
    finalized = true;

    const isPassthrough = mode === STREAM_MODE.PASSTHROUGH;
    let finalUsage = isPassthrough ? usage : state?.usage;

    if (!hasValidUsage(finalUsage) && totalContentLength > 0) {
      finalUsage = estimateStreamUsage(isPassthrough ? FORMATS.OPENAI : sourceFormat);
      if (isPassthrough) usage = finalUsage; else state.usage = finalUsage;
    }

    if (hasValidUsage(finalUsage)) {
      logUsage(isPassthrough ? provider : (state?.provider || targetFormat), finalUsage, model, connectionId, apiKey);
    }

    if (onStreamComplete) {
      onStreamComplete({
        content: accumulatedContent.toString(),
        thinking: accumulatedThinking.toString()
      }, finalUsage, ttftAt, extra);
    }
  };

  const releasePending = () => {
    if (pendingReleased) return;
    pendingReleased = true;
    trackPendingRequest(model, provider, connectionId, false);
  };

  const finalizeOnCancel = () => {
    if (finalized) return;
    releasePending();
    const completed = sawTerminal || openAIResponsesTerminalSeen || !!state?.finishReason;
    finalizeStream(completed ? undefined : { cancelled: true });
  };

  const emitIncludeUsageChunk = (controller) => {
    if (!includeUsage || clientUsageSent || totalContentLength <= 0) return;
    if (sourceFormat !== FORMATS.OPENAI && mode !== STREAM_MODE.PASSTHROUGH) return;
    const estimated = estimateStreamUsage(FORMATS.OPENAI);
    if (mode === STREAM_MODE.PASSTHROUGH) usage = estimated; else if (state && !hasValidUsage(state.usage)) state.usage = estimated;
    const chunk = {
      id: responseMeta.id || `chatcmpl-${Date.now()}`,
      object: "chat.completion.chunk",
      created: responseMeta.created || Math.floor(Date.now() / 1000),
      model: responseMeta.model || model,
      choices: [],
      usage: filterUsageForFormat(estimated, FORMATS.OPENAI)
    };
    const output = `data: ${JSON.stringify(chunk)}\n\n`;
    reqLogger?.appendConvertedChunk?.(output);
    controller.enqueue(sharedEncoder.encode(output));
    clientUsageSent = true;
  };

  const flushPendingCompletion = (controller) => {
    const completed = translateResponse(targetFormat, sourceFormat, null, state);
    for (const item of completed || []) {
      if (item === null || item === undefined) continue;
      const output = formatSSE(item, sourceFormat);
      reqLogger?.appendConvertedChunk?.(output);
      controller.enqueue(sharedEncoder.encode(output));
      sseEmittedCount++;
    }
    finalizeStream();
  };

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      if (!ttftAt) ttftAt = Date.now();
      const text = decoder.decode(chunk, { stream: true });
      buffer += text;
      reqLogger?.appendProviderChunk?.(text);

      if (!text.includes("\n")) return;

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (isDebugEnabled && trimmed) {
          sseLineCount++;
          if (trimmed.startsWith("event:")) {
            const evt = trimmed.slice(6).trim();
            eventTypeCounts[evt] = (eventTypeCounts[evt] || 0) + 1;
          }
        }

        if (mode === STREAM_MODE.TRANSLATE && targetFormat === FORMATS.OPENAI_RESPONSES && trimmed.startsWith("event:")) {
          currentOpenAIResponsesEvent = trimmed.slice(6).trim();
        }

        if (mode === STREAM_MODE.PASSTHROUGH) {
          if (trimmed === "data: [DONE]" || trimmed === "data:[DONE]") { sawTerminal = true; continue; }

          let output;
          let injectedUsage = false;
          let responsesTerminal = false;

          if (trimmed.startsWith("data:") && trimmed.slice(5).trim() === "[DONE]") streamDoneSent = true;

          if (trimmed.startsWith("data:") && trimmed.slice(5).trim() !== "[DONE]") {
            try {
              let parsed = JSON.parse(trimmed.slice(5).trim());

              const idFixed = fixInvalidId(parsed);

              const toolCallIdFixed = ensureStreamToolCallIds(parsed, seenToolCallIds);

              let toolNameRestored = false;
              if (toolNameMap?.size) {
                const restored = restoreToolNames(parsed, toolNameMap);
                if (restored !== parsed) {
                  parsed = restored;
                  toolNameRestored = true;
                }
              }

              let fieldsInjected = false;
              if (parsed.choices !== undefined) {
                if (!parsed.object) { parsed.object = "chat.completion.chunk"; fieldsInjected = true; }
                if (!parsed.created) { parsed.created = Math.floor(Date.now() / 1000); fieldsInjected = true; }
              }

              if (parsed.prompt_filter_results !== undefined) {
                delete parsed.prompt_filter_results;
                fieldsInjected = true;
              }
              if (parsed?.choices) {
                for (const choice of parsed.choices) {
                  if (choice.content_filter_results !== undefined) {
                    delete choice.content_filter_results;
                    fieldsInjected = true;
                  }
                }
              }

              if (liftAliases && parsed?.choices) {
                for (const choice of parsed.choices) {
                  if (choice?.delta) {
                    const lifted = liftReasoningAliases(choice.delta);
                    if (lifted !== choice.delta) {
                      choice.delta = lifted;
                      fieldsInjected = true;
                    }
                  }
                }
              }

              if (parsed?.choices) {
                for (const choice of parsed.choices) {
                  if (choice.delta?.tool_calls && Array.isArray(choice.delta.tool_calls) && choice.delta.tool_calls.length === 0) {
                    delete choice.delta.tool_calls;
                    fieldsInjected = true;
                  }
                }
              }

              if (!hasValuableContent(parsed, FORMATS.OPENAI)) {
                continue;
              }

              const delta = parsed.choices?.[0]?.delta;
              const content = delta?.content;
              const reasoning = delta?.reasoning_content;
              if (content && typeof content === "string") {
                totalContentLength += content.length;
                accumulatedContent.add(content);
              }
              if (reasoning && typeof reasoning === "string") {
                totalContentLength += reasoning.length;
                accumulatedThinking.add(reasoning);
              }
              if (!responseMeta.id && parsed.id) responseMeta = { id: parsed.id, model: parsed.model, created: parsed.created };

              const extracted = extractUsage(parsed);
              if (extracted) {
                usage = mergeUsage(usage, extracted);
              }
              if (hasValidUsage(parsed.usage)) clientUsageSent = true;

              responsesTerminal = isOpenAIResponsesTerminalEvent(currentOpenAIResponsesEvent, parsed);

              if (parsed.choices?.[0]?.finish_reason) sawTerminal = true;
              if (idFixed || fieldsInjected || toolCallIdFixed || toolNameRestored) {
                output = `data: ${JSON.stringify(parsed)}\n`;
                injectedUsage = true;
              }
            } catch {
              continue;
            }
          }

          if (!injectedUsage) {
            if (line.startsWith("data:") && !line.startsWith("data: ")) {
              output = "data: " + line.slice(5) + "\n";
            } else {
              output = line + "\n";
            }
          }

          reqLogger?.appendConvertedChunk?.(output);
          controller.enqueue(sharedEncoder.encode(output));
          if (responsesTerminal) finalizeStream();
          continue;
        }

        if (!trimmed) continue;

        if (trimmed.charCodeAt(0) === 58) { emitHeartbeat(controller); continue; }
        const parsed = parseSSELine(trimmed, targetFormat);
        if (!parsed) continue;
        if (parsed.type === CLAUDE_EVENT.PING) { emitHeartbeat(controller); continue; }

        const isOpenAIResponsesStream = targetFormat === FORMATS.OPENAI_RESPONSES;
        const keepsOpenAIResponsesFormat = isOpenAIResponsesStream && sourceFormat === FORMATS.OPENAI_RESPONSES;
        const openAIResponsesEventName = isOpenAIResponsesStream
          ? getOpenAIResponsesEventName(currentOpenAIResponsesEvent, parsed)
          : null;

        if (isOpenAIResponsesStream && isOpenAIResponsesTerminalEvent(openAIResponsesEventName, parsed)) {
          openAIResponsesTerminalSeen = true;
        }

        if (parsed && parsed.done && targetFormat !== FORMATS.OLLAMA) {
          if (targetFormat === FORMATS.OPENAI && sourceFormat === FORMATS.OPENAI_RESPONSES &&
              state.completionPending && !state.completedSent) {
            flushPendingCompletion(controller);
          }

          if (keepsOpenAIResponsesFormat && !openAIResponsesTerminalSeen) {
            const failedOutput = formatIncompleteOpenAIResponsesStreamFailure();
            reqLogger?.appendConvertedChunk?.(failedOutput);
            controller.enqueue(sharedEncoder.encode(failedOutput));
            openAIResponsesTerminalSeen = true;
            sseEmittedCount++;
          }

          if (keepsOpenAIResponsesFormat && !streamDoneSent) {
            const doneOutput = "data: [DONE]\n\n";
            reqLogger?.appendConvertedChunk?.(doneOutput);
            controller.enqueue(sharedEncoder.encode(doneOutput));
          }
          streamDoneSent = true;
          if (keepsOpenAIResponsesFormat) openAIResponsesDoneSent = true;
          continue;
        }

        if (parsed.delta?.text) {
          totalContentLength += parsed.delta.text.length;
          accumulatedContent.add(parsed.delta.text);
        }
        if (parsed.delta?.thinking) {
          totalContentLength += parsed.delta.thinking.length;
          accumulatedThinking.add(parsed.delta.thinking);
        }
        
        if (parsed.choices?.[0]?.delta?.content) {
          totalContentLength += parsed.choices[0].delta.content.length;
          accumulatedContent.add(parsed.choices[0].delta.content);
        }
        if (parsed.choices?.[0]?.delta?.reasoning_content) {
          totalContentLength += parsed.choices[0].delta.reasoning_content.length;
          accumulatedThinking.add(parsed.choices[0].delta.reasoning_content);
        }
        
        if (parsed.candidates?.[0]?.content?.parts) {
          for (const part of parsed.candidates[0].content.parts) {
            if (part.text && typeof part.text === "string") {
              totalContentLength += part.text.length;
              if (part.thought === true) {
                accumulatedThinking.add(part.text);
              } else {
                accumulatedContent.add(part.text);
              }
            }
          }
        }

        const extracted = extractUsage(parsed);
        if (extracted) state.usage = mergeUsage(state.usage, extracted);

        if (keepsOpenAIResponsesFormat && openAIResponsesEventName) {
          let emitEvent = openAIResponsesEventName;
          let emitData = parsed;
          if (rewriteEvent) {
            const rewritten = rewriteEvent(openAIResponsesEventName, parsed);
            if (!rewritten) {
              currentOpenAIResponsesEvent = null;
              continue;
            }
            emitEvent = rewritten.event;
            emitData = rewritten.data;
          }
          const output = emitData === parsed
            ? formatResponsesPassthroughSSE(emitEvent, parsed, trimmed.slice(5).trim())
            : formatSSE({ event: emitEvent, data: emitData }, sourceFormat);
          reqLogger?.appendConvertedChunk?.(output);
          controller.enqueue(sharedEncoder.encode(output));
          currentOpenAIResponsesEvent = null;
          sseEmittedCount++;
          if (openAIResponsesTerminalSeen) finalizeStream();
          continue;
        }

        currentOpenAIResponsesEvent = null;

        const translated = translateResponse(targetFormat, sourceFormat, parsed, state);

        if (translated?._openaiIntermediate) {
          for (const item of translated._openaiIntermediate) {
            const openaiOutput = formatSSE(item, FORMATS.OPENAI);
            reqLogger?.appendOpenAIChunk?.(openaiOutput);
          }
        }

        if (translated?.length > 0) {
          for (const item of translated) {
            if (item === null || item === undefined) continue;
            if (!hasValuableContent(item, sourceFormat)) {
              continue;
            }

            const isFinishChunk = item.type === CLAUDE_EVENT.MESSAGE_DELTA || item.choices?.[0]?.finish_reason;
            if (isFinishChunk) sawTerminal = true;
            if (state.finishReason && isFinishChunk) {
              if (state.usage && hasValidUsage(state.usage)) {
                item.usage = filterUsageForFormat(state.usage, sourceFormat);
              } else if (sourceFormat !== FORMATS.OPENAI && totalContentLength > 0 && !hasValidUsage(item.usage)) {
                const estimated = estimateStreamUsage(sourceFormat);
                item.usage = filterUsageForFormat(estimated, sourceFormat);
                state.usage = estimated;
              }
            }
            if (hasValidUsage(item.usage)) clientUsageSent = true;

            const output = formatSSE(item, sourceFormat);
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(sharedEncoder.encode(output));
            if (output.startsWith("data: [DONE]")) translatedDoneEmitted = true;
            sseEmittedCount++;
          }
        }

        if (targetFormat === FORMATS.OPENAI && sourceFormat === FORMATS.OPENAI_RESPONSES &&
            state?.completionPending && !state?.completedSent && !completionFlushTimer) {
          completionFlushTimer = setTimeout(() => {
            completionFlushTimer = null;
            if (state?.completedSent) return;
            try { flushPendingCompletion(controller); } catch {}
          }, PENDING_COMPLETION_FLUSH_MS);
        }
      }
    },

    flush(controller) {
      const evtSummary = Object.entries(eventTypeCounts).map(([k, v]) => `${k}=${v}`).join(",") || "none";
      dbg("SSE", `flush | provider=${provider} | model=${model} | recvLines=${sseLineCount} | emitted=${sseEmittedCount} | events=[${evtSummary}]`);
      releasePending();
      try {
        const remaining = decoder.decode();
        if (remaining) buffer += remaining;

        if (mode === STREAM_MODE.PASSTHROUGH) {
          const tail = buffer.trim();
          const tailIsDone = tail.startsWith("data:") && tail.slice(5).trim() === "[DONE]";
          if (!tailIsDone && buffer) {
            let output = buffer;
            if (buffer.startsWith("data:") && !buffer.startsWith("data: ")) {
              output = "data: " + buffer.slice(5);
            }
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(sharedEncoder.encode(output));
          }

          const suppressDone = PROVIDERS[provider]?.quirks?.noDoneSentinel
            || sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI;
          emitIncludeUsageChunk(controller);

          if (!streamDoneSent && !suppressDone) {
            const doneOutput = "data: [DONE]\n\n";
            reqLogger?.appendConvertedChunk?.(doneOutput);
            controller.enqueue(sharedEncoder.encode(doneOutput));
            streamDoneSent = true;
          }

          finalizeStream();
          return;
        }

        if (buffer.trim()) {
          const parsed = parseSSELine(buffer.trim(), targetFormat);
          const isDoneSentinel = parsed?.done && targetFormat !== FORMATS.OLLAMA;
          if (parsed && !isDoneSentinel) {
            const extracted = extractUsage(parsed);
            if (extracted) state.usage = mergeUsage(state.usage, extracted);

            const translated = translateResponse(targetFormat, sourceFormat, parsed, state);

            if (translated?._openaiIntermediate) {
              for (const item of translated._openaiIntermediate) {
                const openaiOutput = formatSSE(item, FORMATS.OPENAI);
                reqLogger?.appendOpenAIChunk?.(openaiOutput);
              }
            }

            if (translated?.length > 0) {
              for (const item of translated) {
                if (item === null || item === undefined) continue;
                const output = formatSSE(item, sourceFormat);
                reqLogger?.appendConvertedChunk?.(output);
                controller.enqueue(sharedEncoder.encode(output));
                if (output.startsWith("data: [DONE]")) translatedDoneEmitted = true;
              }
            }
          }
        }

        const flushed = translateResponse(targetFormat, sourceFormat, null, state);

        if (flushed?._openaiIntermediate) {
          for (const item of flushed._openaiIntermediate) {
            const openaiOutput = formatSSE(item, FORMATS.OPENAI);
            reqLogger?.appendOpenAIChunk?.(openaiOutput);
          }
        }

        if (flushed?.length > 0) {
          for (const item of flushed) {
            if (item === null || item === undefined) continue;
            const output = formatSSE(item, sourceFormat);
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(sharedEncoder.encode(output));
            if (output.startsWith("data: [DONE]")) translatedDoneEmitted = true;
          }
        }

        if (sourceFormat === FORMATS.OPENAI && !translatedDoneEmitted) {
          emitIncludeUsageChunk(controller);
          const doneOutput = "data: [DONE]\n\n";
          reqLogger?.appendConvertedChunk?.(doneOutput);
          controller.enqueue(sharedEncoder.encode(doneOutput));
          translatedDoneEmitted = true;
          streamDoneSent = true;
        }

        const keepsOpenAIResponsesFormat = targetFormat === FORMATS.OPENAI_RESPONSES && sourceFormat === FORMATS.OPENAI_RESPONSES;
        if (keepsOpenAIResponsesFormat && !openAIResponsesTerminalSeen) {
          const failedOutput = formatIncompleteOpenAIResponsesStreamFailure();
          reqLogger?.appendConvertedChunk?.(failedOutput);
          controller.enqueue(sharedEncoder.encode(failedOutput));
          openAIResponsesTerminalSeen = true;
        }

        if (keepsOpenAIResponsesFormat && !openAIResponsesDoneSent && !streamDoneSent) {
          const doneOutput = "data: [DONE]\n\n";
          reqLogger?.appendConvertedChunk?.(doneOutput);
          controller.enqueue(sharedEncoder.encode(doneOutput));
          openAIResponsesDoneSent = true;
          streamDoneSent = true;
        }

        finalizeStream();
      } catch (error) {
        console.log("Error in flush:", error);
        finalizeStream();
      }
    }
  });
  transformStream.finalizeOnCancel = finalizeOnCancel;
  return transformStream;
}

export function createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider = null, reqLogger = null, toolNameMap = null, model = null, connectionId = null, body = null, onStreamComplete = null, apiKey = null, customToolNames = null, credentials = null) {
  return createSSEStream({
    mode: STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat,
    provider,
    reqLogger,
    toolNameMap,
    customToolNames,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey,
    credentials
  });
}

export function createPassthroughStreamWithLogger(provider = null, reqLogger = null, model = null, connectionId = null, body = null, onStreamComplete = null, apiKey = null, toolNameMap = null) {
  return createSSEStream({
    mode: STREAM_MODE.PASSTHROUGH,
    provider,
    reqLogger,
    toolNameMap,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey
  });
}

export function createResponsesRewriteStreamWithLogger(provider = null, reqLogger = null, model = null, connectionId = null, body = null, onStreamComplete = null, apiKey = null, rewriteEvent = null) {
  return createSSEStream({
    mode: STREAM_MODE.TRANSLATE,
    targetFormat: FORMATS.OPENAI_RESPONSES,
    sourceFormat: FORMATS.OPENAI_RESPONSES,
    provider,
    reqLogger,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey,
    rewriteEvent
  });
}
