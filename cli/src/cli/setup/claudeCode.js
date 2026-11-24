const path = require("path");
const { serverRoot, listModels, pickOne, parseJsonConfig, isPlainObject } = require("./shared");

const TIERS = [
  { flag: "fable", envKey: "ANTHROPIC_DEFAULT_FABLE_MODEL" },
  { flag: "opus", envKey: "ANTHROPIC_DEFAULT_OPUS_MODEL" },
  { flag: "sonnet", envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL" },
  { flag: "haiku", envKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL" },
];

function configPath({ env, home }) {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"), "settings.json");
}

async function select(models, opts, deps) {
  const anyFlag = TIERS.some((tier) => opts[tier.flag]);
  const interactive = deps.isTTY && !anyFlag;
  if (interactive) {
    deps.log("Models served by LiteRouter:");
    listModels(models, deps.log);
  }
  const picked = {};
  for (const tier of TIERS) {
    const model = interactive || opts[tier.flag]
      ? await pickOne(models, opts[tier.flag], `${tier.flag} model`, deps, { optional: true })
      : null;
    if (model) picked[tier.flag] = model.id;
  }
  return picked;
}

function build({ text, filePath, baseUrl, apiKey, selection }) {
  const config = parseJsonConfig(text, filePath);
  const env = isPlainObject(config.env) ? config.env : {};
  const root = serverRoot(baseUrl);
  const nextEnv = { ...env, ANTHROPIC_BASE_URL: root, ANTHROPIC_AUTH_TOKEN: apiKey };
  const changes = [`env.ANTHROPIC_BASE_URL -> ${root}`, "env.ANTHROPIC_AUTH_TOKEN set"];
  for (const tier of TIERS) {
    if (!selection[tier.flag]) continue;
    nextEnv[tier.envKey] = selection[tier.flag];
    changes.push(`env.${tier.envKey} -> ${selection[tier.flag]}`);
  }
  return {
    content: `${JSON.stringify({ ...config, env: nextEnv }, null, 2)}\n`,
    changes,
  };
}

module.exports = {
  id: "claude-code",
  summary: "Claude Code: sets the Anthropic endpoint and token in Claude Code's settings.json",
  pathHint: "~/.claude/settings.json (or $CLAUDE_CONFIG_DIR/settings.json)",
  options: `  --opus <id>        Model behind Claude Code's opus tier
  --sonnet <id>      Model behind the sonnet tier
  --haiku <id>       Model behind the haiku tier
  --fable <id>       Model behind the fable tier`,
  next: "Start claude; /model switches between the tiers you mapped.",
  configPath,
  select,
  build,
};
