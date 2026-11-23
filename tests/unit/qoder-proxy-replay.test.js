import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/services/qoderModels.js", () => ({
  getQoderModelConfig: vi.fn(async () => ({ key: "auto", max_output_tokens: 32 })),
  resolveQoderModels: vi.fn(),
  isQoderPat: (t) => String(t || "").startsWith("pt-"),
  resolveQoderCredentials: vi.fn(),
}));

const request = {
  model: "auto",
  body: { messages: [{ role: "user", content: "hello" }], max_tokens: 32 },
  stream: true,
  credentials: {
    accessToken: "dt-test-token",
    providerSpecificData: { userId: "test-user", machineId: "test-machine" },
  },
};

function success() {
  return new Response('data: {"statusCodeValue":200,"body":"[DONE]"}\n\n', {
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function loadExecutor(fetchMock, useProxy = true) {
  vi.resetModules();
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) {
    vi.stubEnv(key, "");
  }
  if (useProxy) vi.stubEnv("HTTPS_PROXY", "http://proxy.test:3128");
  vi.stubGlobal("fetch", fetchMock);
  const { QoderExecutor } = await import("../../open-sse/executors/qoder.js");
  return new QoderExecutor();
}

const { GatewayTimeoutError } = await import("../../open-sse/utils/requestTimeouts.js");
const qoderModels = await import("../../open-sse/services/qoderModels.js");

describe("Qoder abort/timeout propagation", () => {
  it("rethrows client abort from PAT exchange instead of a synthetic 401", async () => {
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    qoderModels.resolveQoderCredentials.mockRejectedValueOnce(abortErr);
    const executor = await loadExecutor(vi.fn());
    await expect(executor.execute({ ...request, credentials: { accessToken: "pt-abc" } })).rejects.toBe(abortErr);
  });

  it("rethrows gateway timeout from body build instead of a synthetic 400", async () => {
    const err = new GatewayTimeoutError("slow", "total");
    qoderModels.getQoderModelConfig.mockRejectedValueOnce(err);
    const executor = await loadExecutor(vi.fn());
    await expect(executor.execute(request)).rejects.toMatchObject({ code: "GATEWAY_TIMEOUT" });
  });

  it("connect timeout is a typed GatewayTimeoutError", async () => {
    const fetchMock = vi.fn((_u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(new TypeError("fetch failed")))));
    const executor = await loadExecutor(fetchMock, false);
    executor.config = { ...executor.config, timeoutMs: 20 };
    await expect(executor.execute(request)).rejects.toMatchObject({ code: "GATEWAY_TIMEOUT", phase: "headers" });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Qoder signed inference transport", () => {
  it.each([null, { strictProxy: false }])("does not replay a signed POST after proxy response loss (%j)", async (proxyOptions) => {
    const seen = new Set();
    const fetchMock = vi.fn(async (_url, options) => {
      const authorization = options.headers.Authorization;
      if (seen.has(authorization)) {
        return new Response('data: {"statusCodeValue":403,"body":"{\\"code\\":\\"103\\",\\"message\\":\\"Duplicate request\\"}"}\n\n');
      }
      seen.add(authorization);
      throw new TypeError("response lost after upstream accepted request");
    });
    const executor = await loadExecutor(fetchMock);
    await expect(executor.execute({ ...request, proxyOptions })).rejects.toThrow("response lost");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].dispatcher).toBeDefined();
    if (proxyOptions) expect(proxyOptions.strictProxy).toBe(false);
  });

  it("generates a fresh COSY identity when the caller retries after transport failure", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(success());
    const executor = await loadExecutor(fetchMock);
    await expect(executor.execute(request)).rejects.toThrow("response lost");
    const result = await executor.execute(request);
    expect(result.response.ok).toBe(true);
    await result.response.text();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const ids = fetchMock.mock.calls.map(([, options]) => JSON.parse(
      Buffer.from(options.headers.Authorization.split(".")[1], "base64").toString(),
    ).requestId);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it.each([true, false])("still supports successful inference with proxy=%s", async (useProxy) => {
    const fetchMock = vi.fn(async () => success());
    const executor = await loadExecutor(fetchMock, useProxy);
    const result = await executor.execute(request);
    expect(result.response.ok).toBe(true);
    await result.response.text();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(!!fetchMock.mock.calls[0][1].dispatcher).toBe(true);
  });

  it("preserves caller cancellation without replaying the request", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_url, options) => {
      controller.abort();
      throw options.signal.reason;
    });
    const executor = await loadExecutor(fetchMock);
    await expect(executor.execute({ ...request, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
