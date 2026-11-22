// Live Claude CLI version lookup — the hardening contract.
//
// Anthropic gates new models on a minimum claude-cli version, so the fingerprint
// is resolved from npm. LiteRouter requires: bounded, cached, one in-flight,
// never below the pinned floor, and never blocking or failing a request.
import { describe, expect, it, afterEach } from "vitest";

import {
  getClaudeCliVersion,
  ensureClaudeCliVersion,
  applyClaudeCliVersion,
  setClaudeCliFallback,
  resetClaudeCliVersion,
} from "../../open-sse/utils/claudeCliVersion.js";
import { CLAUDE_CLI_VERSION } from "../../open-sse/providers/shared.js";

const FLOOR = CLAUDE_CLI_VERSION;

const fakeFetch = (version, { ok = true, throwInstead = false } = {}) => {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, opts });
    if (throwInstead) throw new Error("network down");
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => ({ version }),
    };
  };
  impl.calls = calls;
  return impl;
};

afterEach(() => {
  delete process.env.CLAUDE_CLI_VERSION;
  resetClaudeCliVersion();
});

describe("claudeCliVersion", () => {
  it("pins the floor at 2.1.295, matching the static fingerprint", () => {
    expect(FLOOR).toBe("2.1.295");
    expect(getClaudeCliVersion()).toBe("2.1.295");
  });

  it("never advertises below the floor even if npm returns an older version", async () => {
    setClaudeCliFallback("2.1.295");
    // A lookup result is adopted only when strictly greater than the floor.
    await ensureClaudeCliVersion(fakeFetch("1.0.0"));
    expect(getClaudeCliVersion()).toBe(FLOOR);
  });

  it("fails open: an unreachable registry leaves the floor in place and does not throw", async () => {
    const fetchImpl = fakeFetch(null, { throwInstead: true });
    ensureClaudeCliVersion(fetchImpl);
    await new Promise((r) => setTimeout(r, 0));
    expect(getClaudeCliVersion()).toBe(FLOOR);
  });

  it("fails open on a non-2xx or malformed response", async () => {
    ensureClaudeCliVersion(fakeFetch("2.9.9", { ok: false }));
    await new Promise((r) => setTimeout(r, 0));
    expect(getClaudeCliVersion()).toBe(FLOOR);
    ensureClaudeCliVersion(fakeFetch("not-a-version"));
    await new Promise((r) => setTimeout(r, 0));
    expect(getClaudeCliVersion()).toBe(FLOOR);
  });

  it("reuses one lookup while a refresh is in flight and returns immediately", () => {
    const fetchImpl = fakeFetch("2.2.0");
    const a = ensureClaudeCliVersion(fetchImpl);
    const b = ensureClaudeCliVersion(fetchImpl);
    // Both calls return the last known version synchronously — the refresh is
    // fire-and-forget, so a slow npm registry cannot add latency.
    expect(a).toBe(FLOOR);
    expect(b).toBe(FLOOR);
    expect(fetchImpl.calls.length).toBe(1);
  });

  it("adopts a higher version after the lookup resolves, then stops calling npm", async () => {
    const fetchImpl = fakeFetch("2.2.0");
    ensureClaudeCliVersion(fetchImpl);
    await new Promise((r) => setTimeout(r, 0));
    expect(getClaudeCliVersion()).toBe("2.2.0");
    // Fresh success cache: no second lookup within the TTL.
    ensureClaudeCliVersion(fetchImpl);
    expect(fetchImpl.calls.length).toBe(1);
  });

  it("rewrites only claude-cli/x.y.z in header values", () => {
    setClaudeCliFallback("2.1.295");
    const headers = {
      "User-Agent": "claude-cli/2.1.1 (external, sdk-cli)",
      "X-Other": "claude-cli/9.9.9 should not change unexpectedly",
    };
    const out = applyClaudeCliVersion(headers);
    expect(out["User-Agent"]).toBe(`claude-cli/${getClaudeCliVersion()} (external, sdk-cli)`);
    expect(out["X-Other"]).toContain(`claude-cli/${getClaudeCliVersion()}`);
  });

  it("leaves non-claude headers untouched", () => {
    const headers = { "User-Agent": "GitHubCopilotChat/0.26.7", Authorization: "Bearer x" };
    expect(applyClaudeCliVersion(headers)).toEqual(headers);
  });

  it("never blocks: ensure() returns synchronously with a usable version", () => {
    const pending = fakeFetch("2.2.1");
    const value = ensureClaudeCliVersion(pending);
    expect(typeof value).toBe("string");
    expect(value.split(".").length).toBe(3);
  });
});
