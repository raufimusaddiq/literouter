import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const { runSetup } = require("../src/cli/commands/setup");
const { buildModelEntry } = require("../src/cli/setup/pi");
const { KEY, MASKED, MODELS, makeSetup, cleanupHomes } = require("./helpers/setupHarness");

const PI_FILE = ".pi/agent/models.json";

afterEach(cleanupHomes);

describe("Pi model entries from /v1/models caps", () => {
  it.each([
    ["vision model takes image input", MODELS[0], { input: ["text", "image"], reasoning: true }],
    ["text model takes text only", MODELS[1], { input: ["text"], reasoning: false }],
    ["context and output limits come from the server", MODELS[0], { contextWindow: 400000, maxTokens: 128000 }],
    [
      "reasoning model maps its levels and marks the rest null",
      MODELS[0],
      { thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: null, high: "high", xhigh: "xhigh", max: null } },
    ],
    ["thinking off writes an empty map, never null", MODELS[1], { thinkingLevelMap: {} }],
  ])("%s", (_title, model, expected) => {
    expect(buildModelEntry(model)).toMatchObject(expected);
  });

  it("leaves the map unset when the server reports a level Pi cannot express", () => {
    const entry = buildModelEntry({ id: "zai/glm", capabilities: { reasoning: true }, thinking_levels: ["none", "thinking"] });
    expect(entry).not.toHaveProperty("thinkingLevelMap");
  });
});

describe("literouter setup pi", () => {
  it("calls /v1/models on the normalized base URL and adds only chat models", async () => {
    const ctx = makeSetup("pi", PI_FILE);
    expect(await ctx.run("--all")).toBe(0);
    expect(ctx.requests).toEqual([{ url: "https://ai.example.com/v1/models", auth: `Bearer ${KEY}` }]);
    expect(ctx.read().providers.literouter).toMatchObject({ baseUrl: "https://ai.example.com/v1", apiKey: KEY, api: "openai-completions" });
    expect(ctx.read().providers.literouter.models.map((m) => m.id)).toEqual(["cx/gpt-5.5", "glm/glm-5"]);
  });

  it("keeps other providers, unknown keys and a hand-set model name", async () => {
    const ctx = makeSetup("pi", PI_FILE, {
      existing: {
        theme: "dark",
        providers: {
          ollama: { baseUrl: "http://localhost:11434/v1", models: [{ id: "llama" }] },
          literouter: { headers: { "x-team": "a" }, models: [{ id: "glm/glm-5", name: "GLM five" }] },
        },
      },
    });
    expect(await ctx.run("--models", "glm/glm-5")).toBe(0);
    const config = ctx.read();
    expect(config.theme).toBe("dark");
    expect(config.providers.ollama).toEqual({ baseUrl: "http://localhost:11434/v1", models: [{ id: "llama" }] });
    expect(config.providers.literouter.headers).toEqual({ "x-team": "a" });
    expect(config.providers.literouter.models[0].name).toBe("GLM five");
  });

  it("replaces the file atomically with mode 0600 and keeps a timestamped backup", async () => {
    const ctx = makeSetup("pi", PI_FILE, { existing: { providers: { other: {} } } });
    const before = ctx.text();
    expect(await ctx.run("--all")).toBe(0);
    expect(ctx.files()).toEqual(["models.json", "models.json.bak-20261124-093000"]);
    expect(fs.readFileSync(`${ctx.file}.bak-20261124-093000`, "utf8")).toBe(before);
    if (process.platform !== "win32") expect(fs.statSync(ctx.file).mode & 0o777).toBe(0o600);
  });

  it("re-running with the same choices writes nothing", async () => {
    const ctx = makeSetup("pi", PI_FILE);
    await ctx.run("--all");
    const mtime = fs.statSync(ctx.file).mtimeMs;
    expect(await ctx.run("--all")).toBe(0);
    expect(ctx.files()).toEqual(["models.json"]);
    expect(fs.statSync(ctx.file).mtimeMs).toBe(mtime);
  });

  it("--dry-run prints the config with the key masked and writes nothing", async () => {
    const ctx = makeSetup("pi", PI_FILE);
    expect(await ctx.run("--all", "--dry-run")).toBe(0);
    expect(ctx.output()).toContain(`"apiKey": "${MASKED}"`);
    expect(ctx.output()).not.toContain(KEY);
    expect(fs.existsSync(path.join(ctx.home, ".pi"))).toBe(false);
  });

  it("a rejected key exits 1 without printing it or writing", async () => {
    const ctx = makeSetup("pi", PI_FILE, { status: 401 });
    expect(await ctx.run("--all")).toBe(1);
    expect(ctx.output()).toContain(`rejected the API key ${MASKED} (HTTP 401)`);
    expect(ctx.output()).not.toContain(KEY);
    expect(fs.existsSync(ctx.file)).toBe(false);
  });

  it("fails clearly without a key when there is no terminal to ask", async () => {
    const ctx = makeSetup("pi", PI_FILE);
    expect(await runSetup(["pi", "--all"], ctx.deps)).toBe(1);
    expect(ctx.output()).toContain("--key <key> or set LITEROUTER_API_KEY");
  });

  it("refuses a model id the server does not list", async () => {
    const ctx = makeSetup("pi", PI_FILE);
    expect(await ctx.run("--models", "nope/model")).toBe(1);
    expect(ctx.output()).toContain("nope/model");
  });

  it("leaves an unparseable config untouched", async () => {
    const ctx = makeSetup("pi", PI_FILE, { existing: "{ broken" });
    expect(await ctx.run("--all")).toBe(1);
    expect(ctx.text()).toBe("{ broken");
    expect(ctx.files()).toEqual(["models.json"]);
  });
});
