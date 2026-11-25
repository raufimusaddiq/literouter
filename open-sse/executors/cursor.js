import { BaseExecutor } from "./base.js";
import { PROVIDERS, PROVIDER_OAUTH } from "../config/providers.js";
import { HTTP_STATUS, FETCH_CONNECT_TIMEOUT_MS, NON_STREAM_TOTAL_TIMEOUT_MS, STREAM_STALL_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { GatewayTimeoutError, rethrowIfGatewayAbort, fetchWithTimeouts } from "../utils/requestTimeouts.js";
import {
  generateCursorBody,
  decodeMessage,
  extractTextFromResponse,
  decodeMcpArgs,
} from "../utils/cursorProtobuf.js";
import { buildCursorHeaders } from "../utils/cursorChecksum.js";
import { resolveCursorModels, resolveAutoModelSelection } from "../services/cursorModels.js";
import { estimateUsage } from "../utils/usageTracking.js";
import { SSE_DONE, SSE_HEADERS } from "../utils/sseConstants.js";
import { chatChunkSse, sseChunk } from "../utils/sse.js";
import { FORMATS } from "../translator/formats.js";
import crypto from "crypto";
import {
  AGENT_RUN_PATH,
  agentMessage,
  isAgentCapableRequest,
  buildAgentRunFrame,
  extractAgentString,
  decodeAgentFrames,
  createRequestContextResponse,
  rejectExecRequest,
  encodeKvClientMessage,
  proxyIntentFailed,
} from "./cursorAgentProtocol.js";
import {
  debugLog,
  isComposerModel,
  visibleComposerContentFromThinking,
  readCursorFrame,
  createErrorResponse,
} from "./cursorFrames.js";

export { isAgentCapableRequest, buildAgentRunFrame, encodeKvClientMessage };

const isCloudEnv = () => {
  if (typeof caches !== "undefined" && typeof caches === "object") return true;
  if (typeof EdgeRuntime !== "undefined") return true;
  return false;
};

let http2 = null;
if (!isCloudEnv()) {
  try {
    http2 = await import("http2");
  } catch {
  }
}

export class CursorExecutor extends BaseExecutor {
  constructor() {
    super("cursor", PROVIDERS.cursor);
    this.http2ConnectOptions = {};
  }

  buildUrl() {
    return `${this.config.baseUrl}${this.config.chatPath}`;
  }

  buildHeaders(credentials) {
    const accessToken = credentials.accessToken;
    const machineId = credentials.providerSpecificData?.machineId;
    const ghostMode = credentials.providerSpecificData?.ghostMode !== false;

    if (!machineId) {
      throw new Error("Machine ID is required for Cursor API");
    }

    return buildCursorHeaders(accessToken, machineId, ghostMode);
  }

  transformRequest(model, body, stream, credentials) {
    const messages = body.messages || [];
    const tools = body.tools || [];
    const reasoningEffort = body.reasoning_effort || null;
    const ua = credentials?.rawHeaders?.["user-agent"] || "";
    const forceAgentMode = ua.includes("claude-cli") || ua.includes("claude-code") || ua.includes("Claude Code");
    return generateCursorBody(messages, model, tools, reasoningEffort, forceAgentMode);
  }

  async makeFetchRequest(url, headers, body, signal, proxyOptions = null) {
    const response = await fetchWithTimeouts(url, {
      method: "POST",
      headers,
      body,
    }, proxyOptions, { signal, stream: false });

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: Buffer.from(await response.arrayBuffer())
    };
  }

  makeHttp2Request(url, headers, body, signal) {
    if (!http2) {
      throw new Error("http2 module not available");
    }

    const HTTP2_TIMEOUT_MS = 60000;

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = http2.connect(`https://${urlObj.host}`, this.http2ConnectOptions);
      const chunks = [];
      let responseHeaders = {};
      let settled = false;

      const finish = (fn) => (...args) => {
        if (settled) return;
        settled = true;
        clearTimeout(hangTimeout);
        client.close();
        fn(...args);
      };

      const hangTimeout = setTimeout(finish(() => {
        reject(new Error("HTTP/2 request timed out"));
      }), HTTP2_TIMEOUT_MS);

      client.on("error", finish(reject));

      const req = client.request({
        ":method": "POST",
        ":path": urlObj.pathname,
        ":authority": urlObj.host,
        ":scheme": "https",
        ...headers
      });

      req.on("response", (hdrs) => { responseHeaders = hdrs; });
      req.on("data", (chunk) => { chunks.push(chunk); });
      req.on("end", finish(() => {
        resolve({
          status: responseHeaders[":status"],
          headers: responseHeaders,
          body: Buffer.concat(chunks)
        });
      }));
      req.on("error", finish(reject));

      if (signal) {
        const onAbort = finish(() => reject(new Error("Request aborted")));
        signal.addEventListener("abort", onAbort, { once: true });
      }

      req.write(body);
      req.end();
    });
  }

  openAgentHttp2Stream(url, headers, signal, { stream = true } = {}) {
    if (!http2) {
      throw new Error("HTTP/2 is required for Cursor AgentService (endpoint is h2-only)");
    }

    const urlObj = new URL(url);
    const client = http2.connect(`https://${urlObj.host}`, this.http2ConnectOptions);
    const chunkQueue = [];
    let waiting = null;
    let ended = false;
    let streamError = null;
    let req = null;

    const wake = (result) => {
      if (!waiting) return;
      const resolve = waiting;
      waiting = null;
      resolve(result);
    };

    const fail = (error) => {
      if (streamError) return;
      streamError = error;
      ended = true;
      wake(null);
      onFail?.(error);
    };
    let onFail = null;

    const close = () => {
      try { req?.destroy(); } catch {}
      try { client.close(); } catch {}
    };

    const timeoutFail = (message, phase) => {
      fail(new GatewayTimeoutError(message, phase));
      close();
    };
    let headersTimer = setTimeout(() => timeoutFail(`Cursor AgentService sent no response headers within ${FETCH_CONNECT_TIMEOUT_MS}ms`, "headers"), FETCH_CONNECT_TIMEOUT_MS);
    const totalTimer = stream ? null : setTimeout(() => timeoutFail(`Cursor AgentService did not finish within ${NON_STREAM_TOTAL_TIMEOUT_MS}ms`, "total"), NON_STREAM_TOTAL_TIMEOUT_MS);
    headersTimer.unref?.();
    totalTimer?.unref?.();
    const clearHeadersTimer = () => { if (headersTimer) { clearTimeout(headersTimer); headersTimer = null; } };

    client.on("error", fail);

    req = client.request({
      ":method": "POST",
      ":path": urlObj.pathname,
      ":authority": urlObj.host,
      ":scheme": "https",
      ...headers,
    });

    req.on("error", fail);
    req.on("data", (chunk) => {
      if (waiting) wake({ value: chunk, done: false });
      else chunkQueue.push(chunk);
    });
    req.on("end", () => {
      ended = true;
      clearTimeout(totalTimer);
      wake({ value: undefined, done: true });
    });
    req.on("close", () => { clearHeadersTimer(); clearTimeout(totalTimer); });

    if (signal) {
      const onAbort = () => {
        fail(new Error("Request aborted"));
        close();
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    const responseHeaders = new Promise((resolve, reject) => {
      const onEarlyError = (error) => reject(error);
      onFail = (error) => reject(error);
      client.once("error", onEarlyError);
      req.once("error", onEarlyError);
      req.once("response", (hdrs) => {
        clearHeadersTimer();
        client.off("error", onEarlyError);
        req.off("error", onEarlyError);
        resolve(hdrs);
      });
    });

    return {
      responseHeaders,
      write(frame) {
        if (req && !req.destroyed) req.write(Buffer.from(frame));
      },
      end() {
        try { if (req && !req.destroyed) req.end(); } catch {}
      },
      close,
      async read() {
        if (chunkQueue.length) return { value: chunkQueue.shift(), done: false };
        if (ended) {
          if (streamError) throw streamError;
          return { value: undefined, done: true };
        }
        let idleTimer;
        const result = await new Promise((resolve) => {
          waiting = resolve;
          idleTimer = setTimeout(() => timeoutFail(`Cursor AgentService stalled for ${STREAM_STALL_TIMEOUT_MS}ms`, "idle"), STREAM_STALL_TIMEOUT_MS);
        }).finally(() => clearTimeout(idleTimer));
        if (streamError) throw streamError;
        return result || { value: undefined, done: true };
      },
    };
  }

  async executeAgent({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const agentEndpoint = PROVIDER_OAUTH.cursor?.agentEndpoint;
    if (!agentEndpoint) throw new Error("Cursor AgentService endpoint is not configured");

    if (proxyIntentFailed(proxyOptions)) {
      throw new Error(
        "Cursor AgentService requires a strict proxy that this HTTP/2 transport cannot honor; refusing to open a direct connection"
      );
    }

    const url = `${agentEndpoint}${AGENT_RUN_PATH}`;
    const headers = this.buildHeaders(credentials);
    const requestController = new AbortController();
    if (signal?.addEventListener) {
      signal.addEventListener("abort", () => requestController.abort(signal.reason), { once: true });
    }

    let runModel = model;
    if (model === "default" || model === "auto") {
      const catalog = await resolveCursorModels(credentials, { signal, log });
      const selection = resolveAutoModelSelection(catalog?.models);
      if (selection) {
        log?.info?.("CURSOR", `auto model resolved: ${model} to ${selection.modelId} (${selection.matchedBy})`);
        runModel = selection.modelId;
      }
    }

    let session;
    const tools = body.tools || [];
    try {
      session = this.openAgentHttp2Stream(url, headers, requestController.signal, { stream });
      session.write(buildAgentRunFrame(body.messages || [], runModel, tools, body.reasoning_effort || body.reasoning?.effort));
    } catch (error) {
      throw new Error(`Cursor AgentService request failed: ${error.message}`);
    }

    let responseHeaders;
    try {
      responseHeaders = await session.responseHeaders;
    } catch (error) {
      session.close();
      rethrowIfGatewayAbort(error);
      throw new Error(`Cursor AgentService request failed: ${error.message}`);
    }

    const status = Number(responseHeaders[":status"] || 0);
    if (status !== 200) {
      let errorText = "";
      try {
        while (true) {
          const { done, value } = await session.read();
          if (done) break;
          errorText += Buffer.from(value).toString("utf8");
        }
      } catch {}
      session.close();
      return {
        response: new Response(JSON.stringify({
          error: { message: `Cursor AgentService ${status}: ${errorText || "request failed"}`, type: "api_error" },
        }), { status: status || HTTP_STATUS.SERVER_ERROR, headers: { "Content-Type": "application/json" } }),
        url,
        headers,
        transformedBody: body,
        responseFormat: FORMATS.OPENAI,
      };
    }

    const responseId = `chatcmpl-msg_${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const composerModel = isComposerModel(model);
    let pending = Buffer.alloc(0);
    let finished = false;
    let thinkingAcc = "";
    let emittedVisible = 0;
    let emittedText = false;

    const flushThinkingFallback = (onEvent) => {
      if (emittedText || !thinkingAcc) return;
      const fallback = composerModel
        ? visibleComposerContentFromThinking(thinkingAcc)
        : thinkingAcc.trim();
      if (fallback) {
        emittedText = true;
        onEvent({ type: "text", value: fallback });
      }
    };

    const consume = async (onEvent) => {
      const finishTurn = () => {
        flushThinkingFallback(onEvent);
        finished = true;
        if (emittedText) onEvent({ type: "done" });
        else onEvent({ type: "error", value: "Cursor AgentService returned an empty turn" });
      };
      try {
        while (!finished) {
          const { done, value } = await session.read();
          if (done) break;
          pending = Buffer.concat([pending, Buffer.from(value)]);
          pending = decodeAgentFrames(pending, (payload) => {
            if (finished) return;
            const serverMessage = decodeMessage(payload);

            if (serverMessage.has(1)) {
              const update = decodeMessage(serverMessage.get(1)[0].value);
              if (update.has(1)) {
                const textDelta = extractAgentString(decodeMessage(update.get(1)[0].value), 1);
                if (textDelta) {
                  emittedText = true;
                  onEvent({ type: "text", value: textDelta });
                }
              }
              if (update.has(4)) {
                const thinkingDelta = extractAgentString(decodeMessage(update.get(4)[0].value), 1);
                if (thinkingDelta) {
                  thinkingAcc += thinkingDelta;
                  if (composerModel) {
                    const visible = visibleComposerContentFromThinking(thinkingAcc);
                    if (visible.length > emittedVisible) {
                      const deltaContent = visible.slice(emittedVisible);
                      emittedVisible = visible.length;
                      emittedText = true;
                      onEvent({ type: "text", value: deltaContent });
                    }
                  }
                }
              }
              if (update.has(14)) {
                finishTurn();
              }
            }

            if (serverMessage.has(4)) {
              const kv = decodeMessage(serverMessage.get(4)[0].value);
              const kvId = kv.get(1)?.[0]?.value || 0;
              const metadata = kv.get(4)?.[0]?.value || null;
              if (kv.has(2)) {
                session.write(encodeKvClientMessage(kvId, 2, agentMessage(1, new Uint8Array()), metadata));
              } else if (kv.has(3)) {
                session.write(encodeKvClientMessage(kvId, 3, new Uint8Array(), metadata));
              }
            }

            if (serverMessage.has(2)) {
              const execRequest = decodeMessage(serverMessage.get(2)[0].value);
              if (execRequest.has(10)) {
                log?.info?.("CURSOR", "AgentService request_context ack");
                session.write(createRequestContextResponse(execRequest));
              } else if (execRequest.has(11)) {
                const mcp = decodeMcpArgs(execRequest.get(11)[0].value);
                const name = mcp.toolName || mcp.name;
                if (name) {
                  log?.info?.("CURSOR", `AgentService MCP tool_call ${name}`);
                  finished = true;
                  onEvent({
                    type: "tool_call",
                    value: {
                      id: mcp.toolCallId || `call_${crypto.randomUUID()}`,
                      name,
                      arguments: JSON.stringify(mcp.args || {}),
                    },
                  });
                  onEvent({ type: "done", finishReason: "tool_calls" });
                } else {
                  debugLog(`[CURSOR AGENT] Unsupported exec request fields: ${[...execRequest.keys()].join(",")}`);
                  finished = true;
                  onEvent({ type: "error", value: "Cursor AgentService requested an unsupported IDE tool" });
                }
              } else {
                const rejection = rejectExecRequest(execRequest);
                if (rejection) {
                  log?.info?.("CURSOR", `AgentService rejected IDE exec fields=${[...execRequest.keys()].join(",")}`);
                  session.write(rejection);
                } else {
                  debugLog(`[CURSOR AGENT] Unsupported exec request fields: ${[...execRequest.keys()].join(",")}`);
                  finished = true;
                  onEvent({ type: "error", value: "Cursor AgentService requested an unsupported IDE tool" });
                }
              }
            }
          });
        }
        if (!finished) finishTurn();
      } finally {
        try { session.end(); } catch {}
        try { session.close(); } catch {}
      }
    };

    if (stream === false) {
      let content = "";
      let reasoning = "";
      let agentError = null;
      const toolCalls = [];
      let finishReason = "stop";
      await consume((event) => {
        if (event.type === "text") content += event.value;
        else if (event.type === "thinking") reasoning += event.value;
        else if (event.type === "tool_call") {
          toolCalls.push({
            id: event.value.id,
            type: "function",
            function: { name: event.value.name, arguments: event.value.arguments },
          });
          finishReason = "tool_calls";
        }
        else if (event.type === "error") agentError = event.value;
        else if (event.type === "done" && event.finishReason) finishReason = event.finishReason;
      });
      if (agentError) {
        return {
          response: new Response(JSON.stringify({ error: { message: agentError, type: "api_error" } }), {
            status: HTTP_STATUS.BAD_REQUEST,
            headers: { "Content-Type": "application/json" },
          }),
          url,
          headers,
          transformedBody: body,
          responseFormat: FORMATS.OPENAI,
        };
      }
      const message = {
        role: "assistant",
        content: content || null,
        ...(reasoning ? { reasoning_content: reasoning } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      };
      return {
        response: new Response(JSON.stringify({
          id: responseId,
          object: "chat.completion",
          created,
          model,
          choices: [{ index: 0, message, finish_reason: finishReason }],
          usage: estimateUsage(body, content.length, FORMATS.OPENAI),
        }), { headers: { "Content-Type": "application/json" } }),
        url,
        headers,
        transformedBody: body,
        responseFormat: FORMATS.OPENAI,
      };
    }

    const encoder = new TextEncoder();
    const responseStream = new ReadableStream({
      start(controller) {
        consume((event) => {
          if (event.type === "text") {
            controller.enqueue(encoder.encode(chatChunkSse({ id: responseId, created, model, delta: { content: event.value } })));
          } else if (event.type === "thinking") {
            controller.enqueue(encoder.encode(chatChunkSse({ id: responseId, created, model, delta: { reasoning_content: event.value } })));
          } else if (event.type === "tool_call") {
            controller.enqueue(encoder.encode(chatChunkSse({
              id: responseId, created, model,
              delta: {
                tool_calls: [{
                  index: 0,
                  id: event.value.id,
                  type: "function",
                  function: { name: event.value.name, arguments: event.value.arguments },
                }],
              },
            })));
          } else if (event.type === "error") {
            controller.enqueue(encoder.encode(sseChunk({ error: { message: event.value, type: "api_error" } })));
            controller.enqueue(encoder.encode(SSE_DONE));
            controller.close();
          } else if (event.type === "done") {
            controller.enqueue(encoder.encode(chatChunkSse({
              id: responseId, created, model, delta: {},
              finishReason: event.finishReason || "stop",
            })));
            controller.enqueue(encoder.encode(SSE_DONE));
            controller.close();
          }
        }).catch((error) => controller.error(error));
      },
      cancel() {
        requestController.abort();
      },
    });

    return {
      response: new Response(responseStream, { headers: SSE_HEADERS }),
      url,
      headers,
      transformedBody: body,
      responseFormat: FORMATS.OPENAI,
    };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    if (isAgentCapableRequest(body)) {
      try {
        return await this.executeAgent({ model, body, stream, credentials, signal, log, proxyOptions });
      } catch (error) {
        rethrowIfGatewayAbort(error);
        return {
          response: new Response(JSON.stringify({
            error: { message: error.message, type: "connection_error", code: "" },
          }), { status: HTTP_STATUS.SERVER_ERROR, headers: { "Content-Type": "application/json" } }),
          url: `${PROVIDER_OAUTH.cursor?.agentEndpoint || ""}${AGENT_RUN_PATH}`,
          headers: {},
          transformedBody: body,
        };
      }
    }

    const url = this.buildUrl();
    const headers = this.buildHeaders(credentials);
    const transformedBody = this.transformRequest(model, body, stream, credentials);

    try {
      const shouldForceFetch = proxyOptions?.enabled === true || proxyOptions?.connectionProxyEnabled === true || !!proxyOptions?.vercelRelayUrl;
      const response = (http2 && !shouldForceFetch)
        ? await this.makeHttp2Request(url, headers, transformedBody, signal)
        : await this.makeFetchRequest(url, headers, transformedBody, signal, proxyOptions);

      if (response.status !== 200) {
        const errorText = response.body?.toString() || "Unknown error";
        const errorResponse = new Response(JSON.stringify({
          error: {
            message: `[${response.status}]: ${errorText}`,
            type: "invalid_request_error",
            code: ""
          }
        }), {
          status: response.status,
          headers: { "Content-Type": "application/json" }
        });
        return { response: errorResponse, url, headers, transformedBody: body };
      }

      const transformedResponse = stream !== false
        ? this.transformProtobufToSSE(response.body, model, body)
        : this.transformProtobufToJSON(response.body, model, body);

      return { response: transformedResponse, url, headers, transformedBody: body };
    } catch (error) {
      rethrowIfGatewayAbort(error);
      const errorResponse = new Response(JSON.stringify({
        error: {
          message: error.message,
          type: "connection_error",
          code: ""
        }
      }), {
        status: HTTP_STATUS.SERVER_ERROR,
        headers: { "Content-Type": "application/json" }
      });
      return { response: errorResponse, url, headers, transformedBody: body };
    }
  }

  transformProtobufToJSON(buffer, model, body) {
    const responseId = `chatcmpl-cursor-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    let offset = 0;
    let totalContent = "";
    let totalThinking = "";
    const toolCalls = [];
    const toolCallsMap = new Map();
    const finalizedIds = new Set();
    let frameCount = 0;

    debugLog(`[CURSOR BUFFER] Total length: ${buffer.length} bytes`);

    while (offset < buffer.length) {
      const frame = readCursorFrame(buffer, offset, frameCount, "");
      if (frame.status === "done") break;
      offset = frame.offset;
      frameCount++;
      if (frame.status === "skip") continue;
      const payload = frame.payload;

      if (payload.length > 0 && payload[0] === 0x7b) {
        try {
          const text = payload.toString("utf-8");
          if (text.includes('"error"')) {
            const hasContent = totalContent || toolCallsMap.size > 0;
            debugLog(
              `[CURSOR BUFFER] Error frame (hasContent=${hasContent}): ${text.slice(0, 500)}`
            );
            if (hasContent) {
              break;
            }
            return createErrorResponse(JSON.parse(text));
          }
        } catch {}
      }

      const result = extractTextFromResponse(new Uint8Array(payload));
      debugLog(`[CURSOR DECODED] Frame ${frameCount}:`, result);

      if (result.error) {
        const hasContent = totalContent || toolCallsMap.size > 0;
        debugLog(`[CURSOR BUFFER] Decoded error (hasContent=${hasContent}): ${result.error}`);
        if (hasContent) {
          break;
        }
        return new Response(
          JSON.stringify({
            error: {
              message: result.error,
              type: "rate_limit_error",
              code: "rate_limited"
            }
          }),
          {
            status: HTTP_STATUS.RATE_LIMITED,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (result.toolCall) {
        const tc = result.toolCall;

        if (toolCallsMap.has(tc.id)) {
          const existing = toolCallsMap.get(tc.id);
          existing.function.arguments += tc.function.arguments;
          existing.isLast = tc.isLast;
        } else {
          toolCallsMap.set(tc.id, { ...tc });
        }

        if (tc.isLast) {
          const finalToolCall = toolCallsMap.get(tc.id);
          finalizedIds.add(tc.id);
          toolCalls.push({
            id: finalToolCall.id,
            type: finalToolCall.type,
            function: {
              name: finalToolCall.function.name,
              arguments: finalToolCall.function.arguments
            }
          });
        }
      }

      if (result.text) totalContent += result.text;
      if (result.thinking) totalThinking += result.thinking;
    }

    const visibleComposerContent = isComposerModel(model)
      ? visibleComposerContentFromThinking(totalThinking)
      : "";
    const finalContent = totalContent || visibleComposerContent;

    debugLog(
      `[CURSOR BUFFER] Parsed ${frameCount} frames, toolCallsMap size: ${toolCallsMap.size}, finalized toolCalls: ${toolCalls.length}`
    );

    for (const [id, tc] of toolCallsMap.entries()) {
      if (!finalizedIds.has(id)) {
        debugLog(`[CURSOR BUFFER] Finalizing incomplete tool call: ${id}, isLast=${tc.isLast}`);
        toolCalls.push({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        });
      }
    }

    debugLog(`[CURSOR BUFFER] Final toolCalls count: ${toolCalls.length}`);


    const message = {
      role: "assistant",
      content: finalContent || null
    };

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    const usage = estimateUsage(body, finalContent.length, FORMATS.OPENAI);

    const completion = {
      id: responseId,
      object: "chat.completion",
      created,
      model,
      choices: [{
        index: 0,
        message,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop"
      }],
      usage
    };

    return new Response(JSON.stringify(completion), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  transformProtobufToSSE(buffer, model, body) {
    const responseId = `chatcmpl-cursor-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    const chunks = [];
    let offset = 0;
    let totalContent = "";
    let totalThinking = "";
    let emittedComposerThinkingContentLength = 0;
    const toolCalls = [];
    const toolCallsMap = new Map();
    const finalizedIds = new Set();
    const emittedToolCallIds = new Set();
    let frameCount = 0;

    debugLog(`[CURSOR BUFFER SSE] Total length: ${buffer.length} bytes`);

    while (offset < buffer.length) {
      const frame = readCursorFrame(buffer, offset, frameCount, " SSE");
      if (frame.status === "done") break;
      offset = frame.offset;
      frameCount++;
      if (frame.status === "skip") continue;
      const payload = frame.payload;

      if (payload[0] === 0x7b) {
        try {
          const text = payload.toString("utf-8");
          if (text.includes('"error"')) {
            const hasContent = chunks.length > 0 || totalContent || toolCallsMap.size > 0;
            debugLog(
              `[CURSOR BUFFER SSE] Error frame (hasContent=${hasContent}): ${text.slice(0, 500)}`
            );
            if (hasContent) {
              break;
            }
            return createErrorResponse(JSON.parse(text));
          }
        } catch {}
      }

      const result = extractTextFromResponse(new Uint8Array(payload));
      debugLog(`[CURSOR DECODED SSE] Frame ${frameCount}:`, result);

      if (result.error) {
        const hasContent = chunks.length > 0 || totalContent || toolCallsMap.size > 0;
        debugLog(`[CURSOR BUFFER SSE] Decoded error (hasContent=${hasContent}): ${result.error}`);
        if (hasContent) {
          break;
        }
        return new Response(
          JSON.stringify({
            error: {
              message: result.error,
              type: "rate_limit_error",
              code: "rate_limited"
            }
          }),
          {
            status: HTTP_STATUS.RATE_LIMITED,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (result.toolCall) {
        const tc = result.toolCall;

        if (chunks.length === 0) {
          chunks.push(chatChunkSse({ id: responseId, created, model, delta: { role: "assistant", content: "" } }));
        }

        if (toolCallsMap.has(tc.id)) {
          const existing = toolCallsMap.get(tc.id);
          existing.function.arguments += tc.function.arguments;
          existing.isLast = tc.isLast;

          if (tc.function.arguments) {
            emittedToolCallIds.add(tc.id);
            chunks.push(chatChunkSse({
              id: responseId, created, model,
              delta: {
                tool_calls: [
                  {
                    index: existing.index,
                    id: tc.id,
                    type: "function",
                    function: {
                      name: tc.function.name,
                      arguments: tc.function.arguments
                    }
                  }
                ]
              }
            }));
          }
        } else {
          const toolCallIndex = toolCalls.length;
          finalizedIds.add(tc.id);
          toolCalls.push({ ...tc, index: toolCallIndex });
          toolCallsMap.set(tc.id, { ...tc, index: toolCallIndex });

          emittedToolCallIds.add(tc.id);
          chunks.push(chatChunkSse({
            id: responseId, created, model,
            delta: {
              tool_calls: [
                {
                  index: toolCallIndex,
                  id: tc.id,
                  type: "function",
                  function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments
                  }
                }
              ]
            }
          }));
        }
      }

      if (result.text) {
        totalContent += result.text;
        chunks.push(chatChunkSse({
          id: responseId, created, model,
          delta:
            chunks.length === 0 && toolCalls.length === 0
              ? { role: "assistant", content: result.text }
              : { content: result.text }
        }));
      }

      if (isComposerModel(model) && result.thinking) {
        totalThinking += result.thinking;
        const visibleContent = visibleComposerContentFromThinking(totalThinking);
        if (visibleContent.length > emittedComposerThinkingContentLength) {
          const deltaContent = visibleContent.slice(emittedComposerThinkingContentLength);
          emittedComposerThinkingContentLength = visibleContent.length;
          totalContent += deltaContent;
          chunks.push(chatChunkSse({
            id: responseId, created, model,
            delta:
              chunks.length === 0 && toolCalls.length === 0
                ? { role: "assistant", content: deltaContent }
                : { content: deltaContent }
          }));
        }
      }
    }

    debugLog(
      `[CURSOR BUFFER SSE] Parsed ${frameCount} frames, toolCallsMap size: ${toolCallsMap.size}, toolCalls array: ${toolCalls.length}`
    );

    for (const [id, tc] of toolCallsMap.entries()) {
      if (!finalizedIds.has(id)) {
        debugLog(`[CURSOR BUFFER SSE] Finalizing incomplete tool call: ${id}, isLast=${tc.isLast}`);
        const toolCallIndex = toolCalls.length;
        toolCalls.push({
          id: tc.id,
          type: tc.type,
          index: toolCallIndex,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        });

        if (!emittedToolCallIds.has(tc.id)) {
          chunks.push(chatChunkSse({
            id: responseId, created, model,
            delta: {
              tool_calls: [
                {
                  index: toolCallIndex,
                  id: tc.id,
                  type: "function",
                  function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments
                  }
                }
              ]
            }
          }));
        }
      }
    }

    if (chunks.length === 0 && toolCalls.length === 0) {
      chunks.push(chatChunkSse({ id: responseId, created, model, delta: { role: "assistant", content: "" } }));
    }

    const usage = estimateUsage(body, totalContent.length, FORMATS.OPENAI);

    chunks.push(
      `data: ${JSON.stringify({
        id: responseId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop"
          }
        ],
        usage
      })}\n\n`
    );
    chunks.push(SSE_DONE);

    return new Response(chunks.join(""), {
      status: 200,
      headers: { ...SSE_HEADERS }
    });
  }

  async refreshCredentials() {
    return null;
  }
}

export default CursorExecutor;
