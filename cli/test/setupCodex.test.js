import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const { KEY, MASKED, makeSetup, cleanupHomes } = require("./helpers/setupHarness");

const CODEX_FILE = ".codex/config.toml";
const USER_CONFIG = `model = "o4-mini"
profile = "work"

[model_providers.literouter]
base_url = "http://old/v1"

[model_providers.literouter.http_headers]
X = "y"

[profiles.work]
model = "gpt-5"

[mcp_servers.docs]
command = "npx"
args = ["-y", "docs-mcp"]
`;

afterEach(cleanupHomes);

describe("literouter setup codex", () => {
  it("adds a Responses API provider on <server>/v1 with the key as a static header, and a profile", async () => {
    const ctx = makeSetup("codex", CODEX_FILE);
    expect(await ctx.run("--model", "cx/gpt-5.5")).toBe(0);
    const config = Bun.TOML.parse(ctx.text());
    expect(config.model_providers.literouter).toEqual({
      name: "LiteRouter",
      base_url: "https://ai.example.com/v1",
      wire_api: "responses",
      http_headers: { Authorization: `Bearer ${KEY}` },
    });
    expect(config.profiles.literouter).toEqual({ model: "cx/gpt-5.5", model_provider: "literouter" });
  });

  it("replaces only its own tables and keeps every other table and root key", async () => {
    const ctx = makeSetup("codex", CODEX_FILE, { existing: USER_CONFIG });
    expect(await ctx.run("--model", "cx/gpt-5.5")).toBe(0);
    const config = Bun.TOML.parse(ctx.text());
    expect(config.model).toBe("o4-mini");
    expect(config.profile).toBe("work");
    expect(config.profiles.work).toEqual({ model: "gpt-5" });
    expect(config.mcp_servers.docs).toEqual({ command: "npx", args: ["-y", "docs-mcp"] });
    expect(config.model_providers.literouter.http_headers).toEqual({ Authorization: `Bearer ${KEY}` });
  });

  it("--default makes literouter the default profile and a re-run changes nothing", async () => {
    const ctx = makeSetup("codex", CODEX_FILE, { existing: USER_CONFIG });
    await ctx.run("--model", "cx/gpt-5.5", "--default");
    const first = ctx.text();
    expect(Bun.TOML.parse(first).profile).toBe("literouter");
    expect(await ctx.run("--model", "cx/gpt-5.5", "--default")).toBe(0);
    expect(ctx.text()).toBe(first);
  });

  it("refuses to edit a literouter provider written as an inline table", async () => {
    const existing = `[model_providers]\nliterouter = { base_url = "http://old/v1" }\n`;
    const ctx = makeSetup("codex", CODEX_FILE, { existing });
    expect(await ctx.run("--model", "cx/gpt-5.5")).toBe(1);
    expect(ctx.text()).toBe(existing);
  });

  it("honours CODEX_HOME", async () => {
    const ctx = makeSetup("codex", "codex-home/config.toml");
    ctx.deps.env = { CODEX_HOME: path.join(ctx.home, "codex-home") };
    expect(await ctx.run("--model", "glm/glm-5")).toBe(0);
    expect(Bun.TOML.parse(ctx.text()).profiles.literouter.model).toBe("glm/glm-5");
  });

  it("--dry-run masks the key and writes nothing", async () => {
    const ctx = makeSetup("codex", CODEX_FILE);
    expect(await ctx.run("--model", "cx/gpt-5.5", "--dry-run")).toBe(0);
    expect(ctx.output()).toContain(`Authorization = "Bearer ${MASKED}"`);
    expect(ctx.output()).not.toContain(KEY);
    expect(fs.existsSync(path.join(ctx.home, ".codex"))).toBe(false);
  });
});
