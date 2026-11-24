import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const { KEY, MASKED, MODELS, makeSetup, cleanupHomes } = require("./helpers/setupHarness");
const { buildModelEntry } = require("../src/cli/setup/opencode");

const OPENCODE_FILE = ".config/opencode/opencode.json";

afterEach(cleanupHomes);

describe("OpenCode model entries from /v1/models caps", () => {
  it.each([
    ["vision model takes image input", MODELS[0], { modalities: { input: ["text", "image"], output: ["text"] } }],
    ["limits come from the server", MODELS[1], { limit: { context: 200000, output: 32000 } }],
    ["reasoning levels become variants", MODELS[0], { variants: { none: { reasoningEffort: "none" }, xhigh: { reasoningEffort: "xhigh" } } }],
  ])("%s", (_title, model, expected) => {
    expect(buildModelEntry(model)).toMatchObject(expected);
  });
});

describe("literouter setup opencode", () => {
  it("adds an openai-compatible provider on <server>/v1 and defaults to the first model", async () => {
    const ctx = makeSetup("opencode", OPENCODE_FILE);
    expect(await ctx.run("--models", "glm/glm-5,cx/gpt-5.5")).toBe(0);
    const config = ctx.read();
    expect(config.provider.literouter).toMatchObject({
      npm: "@ai-sdk/openai-compatible",
      options: { baseURL: "https://ai.example.com/v1", apiKey: KEY },
    });
    expect(Object.keys(config.provider.literouter.models)).toEqual(["glm/glm-5", "cx/gpt-5.5"]);
    expect(config.model).toBe("literouter/glm/glm-5");
  });

  it("keeps other providers, the user's default model and tuned variants and modalities", async () => {
    const ctx = makeSetup("opencode", OPENCODE_FILE, {
      existing: {
        model: "anthropic/claude-sonnet",
        theme: "tokyonight",
        provider: {
          anthropic: { options: { apiKey: "{env:ANTHROPIC_API_KEY}" } },
          literouter: { models: { "cx/gpt-5.5": { variants: { fast: { reasoningEffort: "low" } }, modalities: { input: ["text"], output: ["text"] } } } },
        },
      },
    });
    expect(await ctx.run("--models", "cx/gpt-5.5")).toBe(0);
    const config = ctx.read();
    expect(config.model).toBe("anthropic/claude-sonnet");
    expect(config.theme).toBe("tokyonight");
    expect(config.provider.anthropic).toEqual({ options: { apiKey: "{env:ANTHROPIC_API_KEY}" } });
    expect(config.provider.literouter.models["cx/gpt-5.5"]).toMatchObject({
      variants: { fast: { reasoningEffort: "low" } },
      modalities: { input: ["text"], output: ["text"] },
    });
  });

  it("treats a non-string root model as unset", async () => {
    const ctx = makeSetup("opencode", OPENCODE_FILE, { existing: { model: 42 } });
    expect(await ctx.run("--models", "cx/gpt-5.5")).toBe(0);
    expect(ctx.read().model).toBe("literouter/cx/gpt-5.5");
  });

  it("honours XDG_CONFIG_HOME", async () => {
    const ctx = makeSetup("opencode", "xdg/opencode/opencode.json");
    ctx.deps.env = { XDG_CONFIG_HOME: path.join(ctx.home, "xdg") };
    expect(await ctx.run("--all")).toBe(0);
    expect(ctx.read().provider.literouter.options.baseURL).toBe("https://ai.example.com/v1");
  });

  it("--dry-run masks the key and writes nothing", async () => {
    const ctx = makeSetup("opencode", OPENCODE_FILE);
    expect(await ctx.run("--all", "--dry-run")).toBe(0);
    expect(ctx.output()).toContain(`"apiKey": "${MASKED}"`);
    expect(ctx.output()).not.toContain(KEY);
    expect(fs.existsSync(path.join(ctx.home, ".config"))).toBe(false);
  });
});
