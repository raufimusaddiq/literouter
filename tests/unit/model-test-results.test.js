import { describe, expect, it } from "vitest";
import { recordTestResult, TEST_ERROR, TEST_OK } from "@/shared/utils/modelTestResults.js";

describe("model test results", () => {
  it("records a timestamped trace when a model passes", () => {
    const before = Date.now();

    // A passing probe writes no server log line at LOG_LEVEL=WARN, so this
    // recorded result is the only trace the pass leaves.
    const results = recordTestResult({}, "mimo-v2-6-flash", { status: TEST_OK });

    expect(results["mimo-v2-6-flash"].status).toBe("ok");
    expect(results["mimo-v2-6-flash"].error).toBeNull();
    // The trace the row renders: a real timestamp, not just a boolean.
    expect(results["mimo-v2-6-flash"].at).toBeGreaterThanOrEqual(before);
    expect(results["mimo-v2-6-flash"].at).toBeLessThanOrEqual(Date.now());
    // An untested model has no trace at all.
    expect(results["mimo-v2-5-pro"]).toBeUndefined();
  });

  it("keeps each model's error on its own row", () => {
    const errored = recordTestResult({}, "mimo-v2-6-pro", {
      status: TEST_ERROR,
      error: "fetch connect timeout",
    });
    const results = recordTestResult(errored, "mimo-v2-6-flash", { status: TEST_OK });

    // The failing model keeps its message...
    expect(results["mimo-v2-6-pro"]).toMatchObject({
      status: "error",
      error: "fetch connect timeout",
    });
    // ...and the passing model carries none, so its row cannot show pro's failure.
    expect(results["mimo-v2-6-flash"]).toMatchObject({ status: "ok", error: null });
    // An untested model has no result at all.
    expect(results["mimo-v2-5-pro"]).toBeUndefined();
  });

  it("clears a stale error when the same model later passes", () => {
    const failed = recordTestResult({}, "mimo-v2-6-pro", {
      status: TEST_ERROR,
      error: "fetch connect timeout",
    });
    const results = recordTestResult(failed, "mimo-v2-6-pro", { status: TEST_OK });

    expect(results["mimo-v2-6-pro"]).toMatchObject({ status: "ok", error: null });
  });

  it("leaves the store unchanged for an unknown status or missing model id", () => {
    const results = { "mimo-v2-6-flash": { status: "ok", error: null, at: 1 } };

    expect(recordTestResult(results, "mimo-v2-6-flash", { status: "pending" })).toBe(results);
    expect(recordTestResult(results, "", { status: TEST_OK })).toBe(results);
    expect(recordTestResult(results, undefined, { status: TEST_OK })).toBe(results);
  });
});
