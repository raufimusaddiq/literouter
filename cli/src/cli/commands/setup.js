const {
  DEFAULT_URL,
  SetupError,
  parseSetupArgs,
  normalizeBaseUrl,
  maskKey,
  maskText,
  resolveApiKey,
  fetchModels,
  readTextFile,
  writeConfigFile,
  defaultDeps,
} = require("../setup/shared");

const TOOLS = {
  pi: () => require("../setup/pi"),
  "claude-code": () => require("../setup/claudeCode"),
  codex: () => require("../setup/codex"),
  opencode: () => require("../setup/opencode"),
};

const COMMON_HELP = `  --url <url>        LiteRouter server (default: LITEROUTER_URL or ${DEFAULT_URL}); /v1 is added
  --key <key>        LiteRouter API key (default: LITEROUTER_API_KEY, else prompted)
  --dry-run          Print the resulting config with the key masked; write nothing
  -y, --yes          Write without asking
  -h, --help         Show this help`;

function toolHelp(tool) {
  return `
Usage: literouter setup ${tool.id} [options]

${tool.summary}
Writes ${tool.pathHint}.

Options:
${tool.options}
${COMMON_HELP}
`;
}

function generalHelp() {
  const lines = Object.entries(TOOLS).map(([id, load]) => `  ${id.padEnd(12)} ${load().summary}`);
  return `
Usage: literouter setup <tool> [options]

Point a coding tool on this machine at a LiteRouter server.

Tools:
${lines.join("\n")}

Run "literouter setup <tool> --help" for the tool's options.
`;
}

async function runSetup(argv, overrides = {}) {
  const deps = defaultDeps(overrides);
  const [toolId, ...rest] = argv;
  if (!toolId || toolId === "--help" || toolId === "-h") {
    deps.log(generalHelp());
    return toolId ? 0 : 2;
  }
  const load = TOOLS[toolId];
  if (!load) {
    deps.error(`Unknown tool "${toolId}". Supported: ${Object.keys(TOOLS).join(", ")}.`);
    return 2;
  }
  const tool = load();

  let apiKey = null;
  try {
    const opts = parseSetupArgs(rest);
    if (opts.help) {
      deps.log(toolHelp(tool));
      return 0;
    }
    const baseUrl = normalizeBaseUrl(opts.url || deps.env.LITEROUTER_URL || DEFAULT_URL);
    apiKey = await resolveApiKey(opts, deps);
    const models = await fetchModels(baseUrl, apiKey, deps.fetch);
    const selection = await tool.select(models, opts, deps);
    const filePath = tool.configPath(deps);
    const previous = readTextFile(deps.fs, filePath);
    const { content, changes } = tool.build({ text: previous, filePath, baseUrl, apiKey, selection, opts });

    if (opts.dryRun) {
      deps.log(`Dry run: ${filePath} would contain (key masked as ${maskKey(apiKey)}):\n`);
      deps.log(maskText(content, apiKey));
      return 0;
    }
    if (content === previous) {
      deps.log(`${filePath} already points at ${baseUrl}; nothing to change.`);
      return 0;
    }
    if (deps.isTTY && !opts.yes && !(await deps.confirm(`Write ${filePath}?`))) {
      deps.log("Nothing written.");
      return 1;
    }
    const backupPath = writeConfigFile(filePath, content, previous, deps);
    deps.log(`${previous === null ? "Created" : "Updated"} ${filePath}`);
    for (const line of changes) deps.log(`  ${line}`);
    if (backupPath) deps.log(`  previous file saved as ${backupPath}`);
    deps.log(tool.next);
    return 0;
  } catch (err) {
    if (!(err instanceof SetupError)) {
      deps.error(`setup ${toolId} failed: ${maskText(err?.message || err, apiKey)}`);
      return 1;
    }
    deps.error(maskText(err.message, apiKey));
    return 1;
  }
}

module.exports = { runSetup, TOOLS };
