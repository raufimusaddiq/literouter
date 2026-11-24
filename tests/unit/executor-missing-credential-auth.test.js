import { describe, it, expect } from "bun:test";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("DefaultExecutor.buildHeaders() without a credential", () => {
  it("omits Authorization for a combined bearer provider", () => {
    const headers = new DefaultExecutor("mmf").buildHeaders({}, true);
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("omits the raw provider auth header for a combined raw provider", () => {
    const runtimeTransport = { headers: {}, auth: { combined: true, header: "x-api-key", scheme: "raw" } };
    const headers = new DefaultExecutor("mmf").buildHeaders({ runtimeTransport }, true);
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("still sends Bearer Authorization when an accessToken exists", () => {
    const headers = new DefaultExecutor("mmf").buildHeaders({ accessToken: "tok-abc" }, true);
    expect(headers["Authorization"]).toBe("Bearer tok-abc");
  });
});
