const fs = require("fs");
const os = require("os");
const path = require("path");
const { runSetup } = require("../../src/cli/commands/setup");

const KEY = "sk-live-abcdef123456";
const MASKED = "sk-l…3456";
const MODELS = [
  { id: "cx/gpt-5.5", capabilities: { vision: true, reasoning: true }, context_length: 400000, max_completion_tokens: 128000, thinking_levels: ["none", "low", "high", "xhigh"] },
  { id: "glm/glm-5", capabilities: { reasoning: false }, context_length: 200000, max_completion_tokens: 32000 },
  { id: "search", kind: "webSearch" },
];

const homes = [];

function cleanupHomes() {
  for (const dir of homes.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

function makeSetup(tool, configRel, { status = 200, existing, env = {} } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `setup-${tool}-`));
  homes.push(home);
  const file = path.join(home, ...configRel.split("/"));
  if (existing !== undefined) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof existing === "string" ? existing : JSON.stringify(existing));
  }
  const logs = [];
  const requests = [];
  const deps = {
    home,
    env,
    isTTY: false,
    now: () => new Date(2026, 10, 24, 9, 30, 0),
    log: (line) => logs.push(String(line)),
    error: (line) => logs.push(String(line)),
    fetch: async (url, init) => {
      requests.push({ url, auth: init.headers.Authorization });
      return new Response(JSON.stringify({ object: "list", data: MODELS }), { status });
    },
  };
  return {
    home,
    file,
    logs,
    requests,
    deps,
    output: () => logs.join("\n"),
    run: (...args) => runSetup([tool, "--url", "https://ai.example.com", "--key", KEY, ...args], deps),
    text: () => fs.readFileSync(file, "utf8"),
    read: () => JSON.parse(fs.readFileSync(file, "utf8")),
    files: () => fs.readdirSync(path.dirname(file)).sort(),
  };
}

module.exports = { KEY, MASKED, MODELS, makeSetup, cleanupHomes };
