import { setTimeout as sleep } from "node:timers/promises";
import { proxyAwareFetch } from "./proxyFetch.js";
import { FETCH_CONNECT_TIMEOUT_MS, NON_STREAM_TOTAL_TIMEOUT_MS, STREAM_STALL_TIMEOUT_MS, REFRESH_TIMEOUT_MS } from "../config/runtimeConfig.js";

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

export function isAbortError(error) {
  return error?.name === "AbortError" && !isGatewayTimeout(error);
}

export function rethrowIfGatewayAbort(error) {
  if (isGatewayTimeout(error) || isAbortError(error)) throw error;
}

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
    headersArrived: () => { if (stream) clear(); },
    dispose: clear,
    timeoutError: () => {
      const reason = ctrl.signal.reason;
      return ctrl.signal.aborted && !parentSignal?.aborted && isGatewayTimeout(reason) ? reason : null;
    },
  };
}

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

export function refreshSignal(parentSignal, ms = REFRESH_TIMEOUT_MS) {
  const t = AbortSignal.timeout(ms);
  return parentSignal ? AbortSignal.any([parentSignal, t]) : t;
}

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
    try { await reader.cancel(error); } catch {}
    throw error;
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}
