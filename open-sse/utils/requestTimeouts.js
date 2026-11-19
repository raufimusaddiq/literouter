// Shared abort/timeout plumbing for upstream calls.
//
// Three distinct bounds, none of which says anything about account health:
//   - headers timeout: streaming requests, until response headers arrive
//   - total timeout:   non-stream requests, the whole call including the body
//   - idle timeout:    between chunks of a body we read ourselves (readWithIdleTimeout)
// undici's headersTimeout/bodyTimeout on the Agent (proxyFetch.js) are a backstop sized
// above these (UNDICI_BACKSTOP_MS), so these watchdogs always fire first.
import { setTimeout as sleep } from "node:timers/promises";
import { proxyAwareFetch } from "./proxyFetch.js";
import { FETCH_CONNECT_TIMEOUT_MS, NON_STREAM_TOTAL_TIMEOUT_MS, STREAM_STALL_TIMEOUT_MS } from "../config/runtimeConfig.js";

export const GATEWAY_TIMEOUT_CODE = "GATEWAY_TIMEOUT";

export class GatewayTimeoutError extends Error {
  constructor(message, phase = "total") {
    super(message);
    this.name = "TimeoutError";
    this.code = GATEWAY_TIMEOUT_CODE;
    this.status = 504;
    this.phase = phase;
  }
}

export function isGatewayTimeout(error) {
  return error?.code === GATEWAY_TIMEOUT_CODE;
}

/** True for an abort that came from the caller (client gone / stream cancelled), not our timers. */
export function isAbortError(error) {
  return error?.name === "AbortError" && !isGatewayTimeout(error);
}

/**
 * Derive a request signal bound to the caller's signal plus our own timer.
 * Stream: timer covers time-to-headers and is cleared by headersArrived().
 * Non-stream: timer covers the whole call and is cleared only by dispose() or caller abort.
 */
export function createRequestSignal(parentSignal, { stream, headersTimeoutMs = FETCH_CONNECT_TIMEOUT_MS, totalTimeoutMs = NON_STREAM_TOTAL_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const phase = stream ? "headers" : "total";
  const ms = stream ? headersTimeoutMs : totalTimeoutMs;
  let timer = null;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  if (ms > 0) {
    timer = setTimeout(() => {
      timer = null;
      ctrl.abort(new GatewayTimeoutError(stream ? `upstream sent no response headers within ${ms}ms` : `upstream did not finish within ${ms}ms`, phase));
    }, ms);
    timer.unref?.();
  }
  const signal = parentSignal ? AbortSignal.any([parentSignal, ctrl.signal]) : ctrl.signal;
  parentSignal?.addEventListener?.("abort", clear, { once: true });
  return {
    signal,
    /** Stream requests: headers are in, stop the headers timer. */
    headersArrived: () => { if (stream) clear(); },
    dispose: clear,
    /** The gateway timeout that fired, if any (and the caller did not abort first). */
    timeoutError: () => {
      const reason = ctrl.signal.reason;
      return ctrl.signal.aborted && !parentSignal?.aborted && isGatewayTimeout(reason) ? reason : null;
    },
  };
}

/**
 * proxyAwareFetch with the gateway's headers/total timeout. Throws GatewayTimeoutError on
 * timeout, rethrows caller aborts untouched. Never replays.
 */
export async function fetchWithTimeouts(url, init, proxyOptions, { signal, stream, headersTimeoutMs, totalTimeoutMs } = {}) {
  const req = createRequestSignal(signal, { stream, headersTimeoutMs, totalTimeoutMs });
  try {
    const response = await proxyAwareFetch(url, { ...init, signal: req.signal }, proxyOptions);
    req.headersArrived();
    return response;
  } catch (error) {
    req.dispose();
    const timeout = req.timeoutError();
    if (timeout) throw timeout;
    throw error;
  }
}

/** Sleep that rejects with AbortError as soon as the signal aborts. */
export function abortableSleep(ms, signal) {
  return sleep(ms, undefined, signal ? { signal } : undefined);
}

export function throwIfAborted(signal) {
  if (signal?.aborted) {
    const reason = signal.reason;
    if (reason instanceof Error) throw reason;
    const err = new Error("Request aborted");
    err.name = "AbortError";
    throw err;
  }
}

/** reader.read() bounded by an idle timeout and an abort signal. */
export async function readWithIdleTimeout(reader, { signal, timeoutMs = STREAM_STALL_TIMEOUT_MS, message = "upstream stalled" } = {}) {
  throwIfAborted(signal);
  let timer;
  let onAbort;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new GatewayTimeoutError(message, "idle")), timeoutMs);
    onAbort = () => { try { throwIfAborted(signal); } catch (e) { reject(e); } };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([reader.read(), guard]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

/**
 * Read a whole response body with an idle timeout between chunks, a total cap and an
 * abort signal. Cancels the body on any failure so the socket is released.
 * Throws GatewayTimeoutError (idle|total) or the signal's abort error. Never replays.
 */
export async function readBodyBounded(response, { signal, idleMs = STREAM_STALL_TIMEOUT_MS, totalMs = NON_STREAM_TOTAL_TIMEOUT_MS, message = "upstream stalled" } = {}) {
  const body = response?.body;
  if (!body?.getReader) return response.text();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + totalMs;
  let text = "";
  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new GatewayTimeoutError(`upstream body not finished within ${totalMs}ms`, "total");
      const { done, value } = await readWithIdleTimeout(reader, { signal, timeoutMs: Math.min(idleMs, remaining), message });
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    try { await reader.cancel(error); } catch { /* already closed */ }
    throw error;
  } finally {
    try { reader.releaseLock(); } catch { /* released */ }
  }
}
