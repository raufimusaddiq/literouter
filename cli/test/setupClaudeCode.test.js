import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const { KEY, MASKED, makeSetup, cleanupHomes } = require("./helpers/setupHarness");

const CLAUDE_FILE = ".claude/settings.json";

afterEach(cleanupHomes);

describe("literouter setup claude-code", () => {
  it("points Claude Code at the server root, where it appends /v1/messages", async () => {
    const ctx = makeSetup("claude-code", CLAUDE_FILE);
    expect(await ctx.run("--sonnet", "cx/gpt-5.5")).toBe(0);
    expect(ctx.read().env).toEqual({
      ANTHROPIC_BASE_URL: "https://ai.example.com",
      ANTHROPIC_AUTH_TOKEN: KEY,
      ANTHROPIC_DEFAULT_SONNET_MODEL: "cx/gpt-5.5",
    });
  });

  it("keeps unrelated settings, env vars and tiers it was not given", async () => {
    const ctx = makeSetup("claude-code", CLAUDE_FILE, {
      existing: { permissions: { allow: ["Bash(ls)"] }, env: { DISABLE_TELEMETRY: "1", ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm/glm-5" } },
    });
    expect(await ctx.run("--opus", "cx/gpt-5.5")).toBe(0);
    const settings = ctx.read();
    expect(settings.permissions).toEqual({ allow: ["Bash(ls)"] });
    expect(settings.env).toMatchObject({ DISABLE_TELEMETRY: "1", ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm/glm-5", ANTHROPIC_DEFAULT_OPUS_MODEL: "cx/gpt-5.5" });
  });

  it("honours CLAUDE_CONFIG_DIR", async () => {
    const ctx = makeSetup("claude-code", "custom/settings.json");
    ctx.deps.env = { CLAUDE_CONFIG_DIR: path.join(ctx.home, "custom") };
    expect(await ctx.run()).toBe(0);
    expect(ctx.read().env.ANTHROPIC_BASE_URL).toBe("https://ai.example.com");
  });

  it("--dry-run masks the token and writes nothing", async () => {
    const ctx = makeSetup("claude-code", CLAUDE_FILE);
    expect(await ctx.run("--dry-run")).toBe(0);
    expect(ctx.output()).toContain(`"ANTHROPIC_AUTH_TOKEN": "${MASKED}"`);
    expect(ctx.output()).not.toContain(KEY);
    expect(fs.existsSync(path.join(ctx.home, ".claude"))).toBe(false);
  });
});
