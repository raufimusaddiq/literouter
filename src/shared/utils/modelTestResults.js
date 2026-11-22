/**
 * Per-model test outcomes for the provider page's "Test" button.
 *
 * Two problems this module exists to solve:
 *
 *  - A PASSING probe leaves no server log line. Production runs at
 *    `LOG_LEVEL=WARN`, which suppresses `line()` (it returns early above INFO),
 *    and `errorLine()` is documented as reserved for failures ("errors must
 *    never be hidden"). So only failing tests reach the activity log and a
 *    successful test looks like it never happened. Recording the outcome per
 *    model is what gives a pass a visible, timestamped trace without raising
 *    global log verbosity.
 *  - A single page-global error string meant one model's failure was displayed
 *    while a different model's row was being tested. The error belongs to the
 *    model that produced it.
 *
 * Shape: { [modelId]: { status: "ok" | "error", error: string | null, at: number } }
 * `at` (epoch ms) is the trace a passing test leaves; the row renders it.
 *
 * Outcomes for unrelated models are never touched, so a row reads its own
 * entry and cannot show another model's result.
 */

export const TEST_OK = "ok";
export const TEST_ERROR = "error";

/**
 * Record one test outcome under its own model id, leaving every other model's
 * result — including its error — untouched. Invalid input returns `results`
 * unchanged.
 */
export function recordTestResult(results, modelId, { status, error = null } = {}) {
  if (typeof modelId !== "string" || !modelId) return results;
  if (status !== TEST_OK && status !== TEST_ERROR) return results;
  return {
    ...results,
    [modelId]: {
      status,
      // A pass carries no error; a failure keeps the provider's message.
      error: status === TEST_ERROR ? (error || null) : null,
      at: Date.now(),
    },
  };
}
