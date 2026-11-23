
export const TEST_OK = "ok";
export const TEST_ERROR = "error";

export function recordTestResult(results, modelId, { status, error = null } = {}) {
  if (typeof modelId !== "string" || !modelId) return results;
  if (status !== TEST_OK && status !== TEST_ERROR) return results;
  return {
    ...results,
    [modelId]: {
      status,
      error: status === TEST_ERROR ? (error || null) : null,
      at: Date.now(),
    },
  };
}
