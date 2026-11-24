const path = require("path");
const { PROVIDER_KEY, SetupError, listModels, pickOne } = require("./shared");

const OWNED_TABLES = [`model_providers.${PROVIDER_KEY}`, `profiles.${PROVIDER_KEY}`];
const HEADER = /^\s*\[\[?\s*(.+?)\s*\]\]?\s*(#.*)?$/;

function tomlString(value) {
  return JSON.stringify(String(value));
}

function tableName(line) {
  const match = line.match(HEADER);
  return match ? match[1].replace(/["'\s]/g, "") : null;
}

function isOwned(name) {
  return OWNED_TABLES.some((table) => name === table || name.startsWith(`${table}.`));
}

function configPath({ env, home }) {
  return path.join(env.CODEX_HOME || path.join(home, ".codex"), "config.toml");
}

async function select(models, opts, deps) {
  if (!opts.model && deps.isTTY) {
    deps.log("Models served by LiteRouter:");
    listModels(models, deps.log);
  }
  return pickOne(models, opts.model, "Codex model", deps);
}

function editToml(text, { baseUrl, apiKey, model, makeDefault }) {
  const lines = text === null ? [] : text.replace(/\r\n/g, "\n").split("\n");
  const kept = [];
  let skipping = false;
  let inRoot = true;
  for (const line of lines) {
    const name = tableName(line);
    if (name !== null) {
      inRoot = false;
      skipping = isOwned(name);
    }
    if (skipping) continue;
    if (makeDefault && inRoot && /^\s*profile\s*=/.test(line)) continue;
    kept.push(line);
  }
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  if (makeDefault) {
    if (kept.length && tableName(kept[0]) !== null) kept.unshift("");
    kept.unshift(`profile = ${tomlString(PROVIDER_KEY)}`);
  }
  const block = [
    `[model_providers.${PROVIDER_KEY}]`,
    `name = "LiteRouter"`,
    `base_url = ${tomlString(baseUrl)}`,
    `wire_api = "responses"`,
    `http_headers = { Authorization = ${tomlString(`Bearer ${apiKey}`)} }`,
    "",
    `[profiles.${PROVIDER_KEY}]`,
    `model = ${tomlString(model)}`,
    `model_provider = ${tomlString(PROVIDER_KEY)}`,
  ];
  return `${[...kept, ...(kept.length ? [""] : []), ...block].join("\n")}\n`;
}

function withoutOwned(config, makeDefault) {
  const copy = structuredClone(config || {});
  for (const table of ["model_providers", "profiles"]) {
    if (!copy[table] || typeof copy[table] !== "object") continue;
    delete copy[table][PROVIDER_KEY];
    if (Object.keys(copy[table]).length === 0) delete copy[table];
  }
  if (makeDefault) delete copy.profile;
  return JSON.stringify(copy);
}

function build({ text, filePath, baseUrl, apiKey, selection, opts, parseToml = Bun.TOML.parse }) {
  const makeDefault = opts.makeDefault === true;
  let before = {};
  if (text !== null) {
    try {
      before = parseToml(text);
    } catch (err) {
      throw new SetupError(`${filePath} is not valid TOML (${err.message}). Fix or move it, then run setup again; nothing was changed.`);
    }
  }
  const content = editToml(text, { baseUrl, apiKey, model: selection.id, makeDefault });
  const unsafe = `${filePath} defines ${PROVIDER_KEY} in a form setup cannot edit safely. Remove it by hand and run setup again; nothing was changed.`;
  let after;
  try {
    after = parseToml(content);
  } catch {
    throw new SetupError(unsafe);
  }
  const ours = after?.model_providers?.[PROVIDER_KEY]?.base_url === baseUrl && after?.profiles?.[PROVIDER_KEY]?.model === selection.id;
  if (!ours || withoutOwned(after, makeDefault) !== withoutOwned(before, makeDefault)) throw new SetupError(unsafe);
  const changes = [`[model_providers.${PROVIDER_KEY}] -> ${baseUrl} (Responses API)`, `[profiles.${PROVIDER_KEY}] model = ${selection.id}`];
  if (opts.makeDefault) changes.push(`profile = "${PROVIDER_KEY}" (default profile)`);
  return { content, changes };
}

module.exports = {
  id: "codex",
  summary: "Codex CLI: adds a literouter model provider and profile to Codex's config.toml",
  pathHint: "~/.codex/config.toml (or $CODEX_HOME/config.toml)",
  options: `  --model <id>       Model for the literouter profile
  --default          Also make literouter the default profile`,
  next: `Run "codex --profile ${PROVIDER_KEY}" (or plain "codex" if you passed --default).`,
  configPath,
  select,
  build,
  editToml,
};
