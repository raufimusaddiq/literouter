import {
  buildKiroCreateResponseUrl,
  buildKiroCreateResponseBody,
  buildKiroCreateResponseHeaders,
  transformCreateResponseStreamToSSE
} from "../utils/kiroCreateResponse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import {
  KIRO_CODEWHISPERER_TARGET,
  KIRO_ENDPOINT_FALLBACK_STATUSES,
} from "../config/kiroConstants.js";
import { refreshKiroToken } from "../services/tokenRefresh.js";
import { SSE_HEADERS } from "../utils/sseConstants.js";
import { isGatewayTimeout } from "../utils/requestTimeouts.js";
import { STREAM_FIRST_CHUNK_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { buildKiroIdentityHeaders } from "../shared/kiroIdentity.js";
import {
  KIRO_REPAIR_BUFFER_MAX_BYTES,
  KIRO_SERVICE_REGIONS,
  KIRO_REPAIR_HEARTBEAT_MS,
  encoder,
  envPositiveInt,
  concatChunks,
  makeAbortError,
  readWithTimeout,
  readResponsePrefix,
  appendRepairInstruction,
  isEllipsisOnly,
  isShortFutureAction,
  encodeSSEError,
  inspectSSEChunk,
} from "./kiroStreamHelpers.js";
import { transformKiroEventStreamToSSE } from "./kiroEventStream.js";

export class KiroExecutor extends BaseExecutor {
  constructor() {
    super("kiro", PROVIDERS.kiro);
  }

  buildHeaders(credentials, stream = true, url = "") {
    const headers = {
      ...this.config.headers,
      ...buildKiroIdentityHeaders(credentials, "streaming"),
      "Amz-Sdk-Request": "attempt=1; max=3",
      "Amz-Sdk-Invocation-Id": crypto.randomUUID()
    };
    if (url.includes("://codewhisperer.")) {
      headers["X-Amz-Target"] = KIRO_CODEWHISPERER_TARGET;
    } else {
      delete headers["X-Amz-Target"];
    }

    const authMethod = credentials?.providerSpecificData?.authMethod;
    const isApiKey = authMethod === "api_key";
    const isExternalIdp = authMethod === "external_idp";

    const apiKey = credentials?.apiKey || (isApiKey ? credentials?.accessToken : null);
    if (isApiKey && apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
      headers["TokenType"] = "API_KEY";
    } else if (credentials?.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      if (isExternalIdp) {
        headers["TokenType"] = "EXTERNAL_IDP";
      }
    }

    if (credentials?.accessToken) {
      headers["x-amz-sso-bearer"] = credentials.accessToken;
    }
    headers["x-amzn-kiro-agent-mode"] = "spec";
    headers["x-amzn-codewhisperer-machine-id"] = "kiro-desktop";
    const profileArn = credentials?.providerSpecificData?.profileArn;
    if (profileArn) {
      headers["x-amzn-codewhisperer-profile-arn"] = profileArn;
    }

    return headers;
  }

  getOrderedBaseUrls(credentials) {
    const baseUrls = this.getBaseUrls();

    const requestedRegion = (credentials?.providerSpecificData?.region || "us-east-1").trim();
    const isAmazonHost = (u) => {
      try { return new URL(u).hostname.endsWith(".amazonaws.com"); } catch { return false; }
    };
    const regionalize = (u) => {
      if (!isAmazonHost(u)) return u;
      const service = u.match(/\/\/([a-z]+)\.[a-z0-9-]+\.amazonaws\.com/)?.[1];
      const covered = KIRO_SERVICE_REGIONS[service];
      if (!covered || !covered.has(requestedRegion)) return u;
      return u.replace(/([a-z]+)\.[a-z0-9-]+\.amazonaws\.com/, `$1.${requestedRegion}.amazonaws.com`);
    };

    const amazon = baseUrls.filter(isAmazonHost).map(regionalize);
    const others = baseUrls.filter((u) => !isAmazonHost(u));
    const q = amazon.filter((u) => u.includes("://q."));
    const remaining = amazon.filter((u) => !u.includes("://q."));
    return q.length > 0
      ? [...q, ...remaining, ...others]
      : [...amazon, ...others];
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const baseUrls = this.getOrderedBaseUrls(credentials);
    const url = baseUrls[urlIndex] || baseUrls[0] || this.config.baseUrl;
    return url;
  }

  shouldRetry(status, urlIndex) {
    const hasFallback = urlIndex + 1 < this.getFallbackCount();
    return super.shouldRetry(status, urlIndex)
      || (hasFallback && KIRO_ENDPOINT_FALLBACK_STATUSES.has(status));
  }

  transformRequest(model, body, stream, credentials) {
    return body;
  }

  async execute(args) {
    const crMode = (process.env.LITEROUTER_KIRO_CREATE_RESPONSE || process.env.KIRO_CREATE_RESPONSE || "auto").toLowerCase();

    if (crMode === "always" && args?.body?.conversationState) {
      args.log?.debug?.("KIRO", "Using /v1/responses CreateResponse (direct mode)");
      const crResult = await this.executeCreateResponse(args);
      if (crResult?.response?.ok) return crResult;
      args.log?.warn?.("KIRO", `CreateResponse (direct mode) answered ${crResult?.response?.status ?? "no response"}, using generateAssistantResponse`);
    }

    let result = await super.execute(args);

    if (result?.response?.status === 429 && args?.body?.conversationState && crMode !== "off" && crMode !== "always") {
      let isRateExceeded = false;
      let errorBody = "";
      try {
        if (typeof result.response.clone === "function") {
          errorBody = await result.response.clone().text();
        } else {
          errorBody = await result.response.text();
          result.response = new Response(errorBody, {
            status: result.response.status,
            statusText: result.response.statusText,
            headers: result.response.headers
          });
        }
        isRateExceeded = errorBody.includes("USER_REQUEST_RATE_EXCEEDED");
      } catch {}

      if (isRateExceeded) {
        args.log?.warn?.("KIRO", "generateAssistantResponse hit USER_REQUEST_RATE_EXCEEDED, falling back to /v1/responses CreateResponse");
        try {
          const fallbackResult = await this.executeCreateResponse(args);
          if (fallbackResult?.response?.ok) {
            return fallbackResult;
          }
          if (fallbackResult?.response) {
            return fallbackResult;
          }
        } catch (err) {
          args.log?.error?.("KIRO", `CreateResponse fallback failed: ${err && err.message || err}`);
        }
      }
    }

    if (result?.response?.ok) {
      if (process.env.KIRO_INTEGRITY_GATE === "off") {
        result.response = this.transformEventStreamToSSE(result.response, args.model, {
          toolSpecs: args.body?.conversationState?.currentMessage?.userInputMessage?.userInputMessageContext?.tools || []
        });
      } else {
        this.attachIntegrityGate(result, args);
      }
    }
    return result;
  }

  async executeCreateResponse(args) {
    const { model, body, credentials, signal, log, proxyOptions = null } = args;
    const region = (credentials?.providerSpecificData?.region || "us-east-1").trim() || "us-east-1";
    const url = buildKiroCreateResponseUrl(region);
    const crBody = buildKiroCreateResponseBody({ body, credentials, model });
    const headers = buildKiroCreateResponseHeaders({ credentials, body });

    log?.debug?.("KIRO", `CreateResponse -> ${url} | model=${crBody.model}`);

    let response;
    try {
      response = await proxyAwareFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(crBody),
        signal
      }, proxyOptions);

      if (response.status === 429 && !signal?.aborted) {
        log?.warn?.("KIRO", "CreateResponse received 429, waiting 1500ms before retry...");
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (!signal?.aborted) {
          response = await proxyAwareFetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(crBody),
            signal
          }, proxyOptions);
        }
      }
    } catch (err) {
      log?.error?.("KIRO", `CreateResponse network failure: ${err && err.message || err}`);
      return null;
    }

    if (!response.ok) {
      log?.warn?.("KIRO", `CreateResponse returned status ${response.status}`);
      return { response, url, headers, transformedBody: crBody };
    }

    const transformedStream = transformCreateResponseStreamToSSE(response.body, model);
    const sseResponse = new Response(transformedStream, {
      status: 200,
      headers: { ...SSE_HEADERS }
    });

    return { response: sseResponse, url, headers, transformedBody: crBody };
  }

  attachIntegrityGate(result, args) {
    const abortController = new AbortController();
    const maxBytes = envPositiveInt("KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES", KIRO_REPAIR_BUFFER_MAX_BYTES);
    const legacyTimeout = envPositiveInt("KIRO_TOOL_CALL_REPAIR_TIMEOUT_MS", STREAM_FIRST_CHUNK_TIMEOUT_MS);
    const ttftTimeoutMs = envPositiveInt("KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS", legacyTimeout);
    const stallTimeoutMs = envPositiveInt("KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS", legacyTimeout);
    const repairEnabled = args.credentials?.providerSpecificData?.kiroToolCallRepair !== false &&
      process.env.KIRO_TOOL_CALL_REPAIR !== "false";
    const forwardAbort = () => abortController.abort(args.signal?.reason);
    args.signal?.addEventListener("abort", forwardAbort, { once: true });
    let open = true;
    let heartbeatTimer;

    const stream = new ReadableStream({
      start: async (controller) => {
        const heartbeat = () => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(": kiro-validation\n\n"));
          } catch {
            open = false;
          }
        };
        heartbeat();
        heartbeatTimer = setInterval(heartbeat, KIRO_REPAIR_HEARTBEAT_MS);

        try {
          const bytes = await this.runIntegrityRecovery(result.response, args, {
            signal: abortController.signal,
            maxBytes,
            ttftTimeoutMs,
            stallTimeoutMs,
            repairEnabled
          });
          if (abortController.signal.aborted) throw makeAbortError(abortController.signal.reason);
          controller.enqueue(bytes);
          controller.close();
        } catch (error) {
          if (open && (error.name === "AbortError" || isGatewayTimeout(error))) {
            controller.error(error);
          } else if (open) {
            controller.enqueue(encodeSSEError(
              "kiro_integrity_gate_failed",
              error.message || "Kiro integrity validation failed"
            ));
            controller.close();
          }
        } finally {
          open = false;
          clearInterval(heartbeatTimer);
          args.signal?.removeEventListener?.("abort", forwardAbort);
        }
      },
      cancel(reason) {
        open = false;
        clearInterval(heartbeatTimer);
        abortController.abort(reason || "client cancelled");
      }
    });

    result.response = new Response(stream, {
      status: result.response.status,
      statusText: result.response.statusText,
      headers: { ...SSE_HEADERS }
    });
  }

  async runIntegrityRecovery(rawResponse, args, options) {
    const first = await this.readRecoverableIntegrityAttempt(
      rawResponse,
      args.model,
      options,
      "initial"
    );
    if (first.kind === "complete") return first.bytes;
    if (first.kind === "terminal_stop" || first.kind === "upstream_error") {
      return this.integrityFailureSSE(first);
    }
    if (first.kind === "invalid_tool" && !options.repairEnabled) {
      return encodeSSEError("invalid_kiro_tool_call", first.message, first.diagnostics);
    }

    const repairKind = ["ellipsis", "short_final", "invalid_tool"].includes(first.kind)
      ? first.kind
      : null;
    const repairBody = repairKind
      ? appendRepairInstruction(args.body, repairKind === "invalid_tool" ? "tool" : repairKind)
      : structuredClone(args.body || {});

    const retry = await BaseExecutor.prototype.execute.call(this, {
      ...args,
      body: repairBody,
      signal: options.signal
    });
    if (!retry?.response?.ok) {
      let body = "";
      try {
        body = await readResponsePrefix(
          retry?.response,
          options.signal,
          Math.min(options.maxBytes, 4096),
          options.stallTimeoutMs
        );
      } catch (error) {
        if (error.name === "AbortError" || isGatewayTimeout(error)) throw error;
      }
      return encodeSSEError(
        "kiro_integrity_retry_upstream_error",
        body || `Kiro integrity retry failed with HTTP ${retry?.response?.status || 502}`,
        { status: retry?.response?.status || 502 }
      );
    }

    const second = await this.readRecoverableIntegrityAttempt(
      retry.response,
      args.model,
      options,
      "retry"
    );
    if (second.kind === "complete") return second.bytes;
    if (second.kind === "terminal_stop" || second.kind === "upstream_error") {
      return this.integrityFailureSSE(second);
    }
    const code = second.kind === "ellipsis"
      ? "kiro_ellipsis_retry_failed"
      : second.kind === "short_final"
        ? "kiro_short_final_retry_failed"
        : second.kind === "invalid_tool"
          ? "kiro_tool_call_repair_retry_failed"
          : "kiro_missing_terminal_retry_failed";
    return encodeSSEError(
      code,
      `Kiro integrity validation failed after one bounded retry: ${second.message || second.kind}`,
      { attempts: [first.diagnostics, second.diagnostics].filter(Boolean) }
    );
  }

  integrityFailureSSE(attempt) {
    const disposition = attempt.diagnostics?.stop_disposition;
    const code = attempt.diagnostics?.terminal_provenance === "integrity_buffer_exceeded"
      ? "kiro_integrity_buffer_exceeded"
      : attempt.kind === "upstream_error"
      ? "kiro_upstream_eventstream_error"
      : disposition === "terminal_refusal"
        ? "kiro_terminal_refusal"
        : disposition === "terminal_incomplete"
          ? "kiro_terminal_incomplete"
          : "kiro_unknown_stop_reason";
    return encodeSSEError(code, attempt.message || "Kiro stream ended with a terminal failure", attempt.diagnostics);
  }

  async readRecoverableIntegrityAttempt(rawResponse, model, options, attempt) {
    try {
      return await this.readIntegrityAttempt(rawResponse, model, options, attempt);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      return {
        kind: "missing_terminal",
        message: error.message || "Kiro transport read failed",
        diagnostics: {
          attempt,
          terminal_provenance: "transport_read_error",
          transport_state: "upstream_error",
          stop_reason: null,
          stop_disposition: "terminal_incomplete",
          response_state: "no_semantic_output",
          event_counts: {},
          incomplete_frame_bytes: 0
        }
      };
    }
  }

  async readIntegrityAttempt(rawResponse, model, options, attempt) {
    let diagnostics;
    const transformed = this.transformEventStreamToSSE(rawResponse, model, {
      maxToolBytes: Math.max(1, Math.floor(options.maxBytes / 2)),
      onTerminalState: (value) => {
        diagnostics = value;
      }
    });
    const reader = transformed.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    let sawChunk = false;
    const output = { content: "", reasoning: "", hasToolCalls: false, error: null };

    try {
      while (true) {
        const timeoutMs = sawChunk ? options.stallTimeoutMs : options.ttftTimeoutMs;
        const phase = sawChunk ? "stalled" : "timed out before first chunk";
        const { done, value } = await readWithTimeout(
          reader,
          options.signal,
          timeoutMs,
          `Kiro integrity validation ${phase}`
        );
        if (done) break;
        sawChunk = true;
        totalBytes += value.byteLength;
        if (totalBytes > options.maxBytes) {
          await reader.cancel("kiro_integrity_buffer_exceeded").catch(() => {});
          return {
            kind: "terminal_stop",
            message: `Kiro integrity buffer exceeded ${options.maxBytes} bytes`,
            diagnostics: { terminal_provenance: "integrity_buffer_exceeded" }
          };
        }
        chunks.push(value);
        inspectSSEChunk(value, output);
      }
    } catch (error) {
      await reader.cancel(error.message).catch(() => {});
      throw error;
    }

    const safeDiagnostics = {
      attempt,
      terminal_provenance: diagnostics?.terminal_provenance || "missing_terminal_diagnostics",
      transport_state: diagnostics?.transport_state || "unknown",
      stop_reason: diagnostics?.stop_reason || null,
      stop_disposition: diagnostics?.stop_disposition || "terminal_incomplete",
      response_state: diagnostics?.response_state || "no_semantic_output",
      event_counts: diagnostics?.event_counts || {},
      incomplete_frame_bytes: diagnostics?.incomplete_frame_bytes || 0
    };
    if (safeDiagnostics.stop_disposition === "retryable_protocol_failure") {
      const kind = safeDiagnostics.terminal_provenance === "invalid_tool_call"
        ? "invalid_tool"
        : "retryable_stop";
      return { kind, message: output.error?.message, diagnostics: safeDiagnostics };
    }
    if (safeDiagnostics.stop_disposition === "terminal_incomplete" ||
        safeDiagnostics.stop_disposition === "terminal_refusal" ||
        safeDiagnostics.stop_disposition === "unknown_failure") {
      const kind = safeDiagnostics.terminal_provenance === "upstream_eventstream_error"
        ? "upstream_error"
        : safeDiagnostics.terminal_provenance === "integrity_buffer_exceeded"
          ? "terminal_stop"
        : ["metadata_stop_reason", "message_stop_event"].includes(safeDiagnostics.terminal_provenance)
          ? "terminal_stop"
          : "missing_terminal";
      return { kind, message: output.error?.message, diagnostics: safeDiagnostics };
    }
    if (output.error) {
      return { kind: "missing_terminal", message: output.error.message, diagnostics: safeDiagnostics };
    }
    if (!output.hasToolCalls) {
      if (isEllipsisOnly(output.content) ||
          (!output.content.trim() && isEllipsisOnly(output.reasoning))) {
        return { kind: "ellipsis", diagnostics: safeDiagnostics };
      }
      if (isShortFutureAction(output.content)) {
        return { kind: "short_final", diagnostics: safeDiagnostics };
      }
    }
    return { kind: "complete", bytes: concatChunks(chunks, totalBytes), diagnostics: safeDiagnostics };
  }

  transformEventStreamToSSE(response, model, options = {}) {
    return transformKiroEventStreamToSSE(response, model, options);
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials.refreshToken) return null;

    try {
      const result = await refreshKiroToken(
        credentials.refreshToken,
        credentials.providerSpecificData,
        log,
        proxyOptions
      );

      return result;
    } catch (error) {
      log?.error?.("TOKEN", `Kiro refresh error: ${error.message}`);
      return null;
    }
  }
}

export default KiroExecutor;
