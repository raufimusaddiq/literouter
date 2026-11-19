import { describe, it, expect } from "vitest";

import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import { GatewayTimeoutError, isGatewayTimeout, isAbortError } from "../../open-sse/utils/requestTimeouts.js";

const credentials = { accessToken: "t", providerSpecificData: { machineId: "a".repeat(64) } };
const agentBody = { messages: [{ role: "user", content: "hi" }] };
const legacyBody = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA" } }] }] };

function abortError() {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

function stubHeadersFailure(executor, error) {
  executor.openAgentHttp2Stream = () => ({
    responseHeaders: Promise.reject(error),
    write() {}, end() {}, close() {},
    async read() { return { done: true }; },
  });
}

describe("Cursor execute() propagates timeouts and aborts instead of a synthetic 500", () => {
  it("agent path: headers timeout rejects as GatewayTimeoutError (-> 504, no account fallback)", async () => {
    const ex = new CursorExecutor();
    stubHeadersFailure(ex, new GatewayTimeoutError("headers timeout", "headers"));
    const err = await ex.execute({ model: "gpt-5.2", body: agentBody, stream: true, credentials }).catch((e) => e);
    expect(isGatewayTimeout(err)).toBe(true);
    expect(err.status).toBe(504);
  });

  it("agent path: client abort rejects as AbortError (-> 499)", async () => {
    const ex = new CursorExecutor();
    stubHeadersFailure(ex, abortError());
    const err = await ex.execute({ model: "gpt-5.2", body: agentBody, stream: true, credentials }).catch((e) => e);
    expect(isAbortError(err)).toBe(true);
  });

  it("agent path: ordinary failures are still wrapped into a 500", async () => {
    const ex = new CursorExecutor();
    stubHeadersFailure(ex, new Error("boom"));
    const res = await ex.execute({ model: "gpt-5.2", body: agentBody, stream: true, credentials });
    expect(res.response.status).toBe(500);
  });

  it("fetch/http2 path: gateway timeout and abort propagate", async () => {
    for (const [error, check] of [
      [new GatewayTimeoutError("total timeout", "total"), isGatewayTimeout],
      [abortError(), isAbortError],
    ]) {
      const ex = new CursorExecutor();
      ex.makeHttp2Request = () => Promise.reject(error);
      ex.makeFetchRequest = () => Promise.reject(error);
      const err = await ex.execute({ model: "gpt-4o", body: legacyBody, stream: true, credentials }).catch((e) => e);
      expect(check(err)).toBe(true);
    }
  });

  it("fetch/http2 path: ordinary failures are still wrapped into a 500", async () => {
    const ex = new CursorExecutor();
    ex.makeHttp2Request = () => Promise.reject(new Error("boom"));
    ex.makeFetchRequest = () => Promise.reject(new Error("boom"));
    const res = await ex.execute({ model: "gpt-4o", body: legacyBody, stream: true, credentials });
    expect(res.response.status).toBe(500);
  });
});
