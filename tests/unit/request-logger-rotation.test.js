import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("request logs stay within session and size limits", async () => {
  process.env.ENABLE_REQUEST_LOGS = "true";
  process.env.REQUEST_LOG_MAX_SIZE_MB = "1";
  process.env.REQUEST_LOG_MAX_SESSIONS = "2";
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-request-logs-"));
  process.chdir(tempDir);

  try {
    fs.mkdirSync(path.join(tempDir, "logs", "old-1"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "logs", "old-2"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "logs", "old-1", "large.txt"), "x".repeat(700_000));
    fs.writeFileSync(path.join(tempDir, "logs", "old-2", "large.txt"), "x".repeat(700_000));
    fs.utimesSync(path.join(tempDir, "logs", "old-1"), new Date(0), new Date(0));
    fs.utimesSync(path.join(tempDir, "logs", "old-2"), new Date(1_000), new Date(1_000));

    const { createRequestLogger } = await import("../../open-sse/utils/requestLogger.js");
    await createRequestLogger("openai", "openai", "test-model");
    const sessions = fs.readdirSync(path.join(tempDir, "logs"));
    assert.equal(sessions.length, 2);
    assert.equal(sessions.includes("old-1"), false);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
