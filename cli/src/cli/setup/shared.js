const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { Writable } = require("stream");

const PROVIDER_KEY = "literouter";
const DEFAULT_URL = "http://127.0.0.1:20128";
const FETCH_TIMEOUT_MS = 15000;

const VALUE_FLAGS = {
  "--url": "url",
  "--key": "key",
  "--models": "models",
  "--model": "model",
  "--opus": "opus",
  "--sonnet": "sonnet",
  "--haiku": "haiku",
};

const BOOL_FLAGS = {
  "--all": "all",
  "--default": "makeDefault",
  "--dry-run": "dryRun",
  "--yes": "yes",
  "-y": "yes",
  "--help": "help",
  "-h": "help",
};

class SetupError extends Error {}

function parseSetupArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const flag = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
    if (VALUE_FLAGS[flag]) {
      const value = eq > 0 && flag !== arg ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value === "") throw new SetupError(`${flag} needs a value`);
      opts[VALUE_FLAGS[flag]] = value;
    } else if (BOOL_FLAGS[arg]) {
      opts[BOOL_FLAGS[arg]] = true;
    } else {
      throw new SetupError(`Unknown option: ${arg}`);
    }
  }
  if (opts.models) opts.models = opts.models.split(",").map((id) => id.trim()).filter(Boolean);
  return opts;
}

function normalizeBaseUrl(raw) {
  const text = String(raw || "").trim();
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new SetupError(`Invalid server URL: ${text || "(empty)"}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SetupError(`Server URL must be http or https: ${text}`);
  url.search = "";
  url.hash = "";
  const base = url.toString().replace(/\/+$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

function serverRoot(baseUrl) {
  return baseUrl.replace(/\/v1$/, "");
}

function maskKey(key) {
  const text = String(key || "");
  if (text.length <= 8) return "****";
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function maskText(text, key) {
  return key ? String(text).split(key).join(maskKey(key)) : String(text);
}

function promptHidden(question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve) => {
    const muted = new Writable({ write: (_chunk, _enc, done) => done() });
    const rl = readline.createInterface({ input, output: muted, terminal: true });
    output.write(question);
    rl.question("", (answer) => {
      rl.close();
      output.write("\n");
      resolve(String(answer || "").trim());
    });
  });
}

async function resolveApiKey(opts, deps) {
  if (opts.key) return opts.key;
  if (deps.env.LITEROUTER_API_KEY) return deps.env.LITEROUTER_API_KEY;
  if (!deps.isTTY) throw new SetupError("No API key: pass --key <key> or set LITEROUTER_API_KEY (create one in the dashboard under API Keys).");
  const key = await deps.promptSecret("LiteRouter API key: ");
  if (!key) throw new SetupError("No API key entered.");
  return key;
}

function isChatModel(model) {
  return Boolean(model && typeof model.id === "string" && model.id && !model.kind);
}

async function fetchModels(baseUrl, apiKey, fetchImpl) {
  const url = `${baseUrl}/models`;
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new SetupError(`Cannot reach ${url}: ${maskText(err?.message || err, apiKey)}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new SetupError(`The server rejected the API key ${maskKey(apiKey)} (HTTP ${res.status}). Check the key in the dashboard under API Keys.`);
  }
  if (!res.ok) throw new SetupError(`${url} answered HTTP ${res.status}.`);
  let body;
  try {
    body = await res.json();
  } catch {
    throw new SetupError(`${url} did not return JSON. Is this a LiteRouter server?`);
  }
  const list = Array.isArray(body?.data) ? body.data : [];
  return list.filter(isChatModel);
}

function modelInfo(model) {
  const caps = model?.capabilities || {};
  return {
    vision: caps.vision === true,
    reasoning: caps.reasoning === true,
    contextWindow: model?.context_length ?? caps.contextWindow,
    maxOutput: model?.max_completion_tokens ?? caps.maxOutput,
    thinkingLevels: Array.isArray(model?.thinking_levels) ? model.thinking_levels : null,
  };
}

function parseSelection(answer, count) {
  const text = String(answer || "").trim().toLowerCase();
  if (text === "all" || text === "*") return Array.from({ length: count }, (_, i) => i);
  const picked = new Set();
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)-(\d+)$/);
    const [from, to] = range ? [Number(range[1]), Number(range[2])] : [Number(part), Number(part)];
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > count || from > to) return null;
    for (let n = from; n <= to; n++) picked.add(n - 1);
  }
  return picked.size > 0 ? [...picked].sort((a, b) => a - b) : null;
}

function listModels(models, log) {
  const width = String(models.length).length;
  models.forEach((model, i) => log(`  ${String(i + 1).padStart(width)}. ${model.id}`));
}

function findModels(models, ids) {
  const byId = new Map(models.map((model) => [model.id, model]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new SetupError(`Not served by this server (or not allowed for this key): ${missing.join(", ")}`);
  return ids.map((id) => byId.get(id));
}

async function pickMany(models, opts, deps) {
  if (models.length === 0) throw new SetupError("The server lists no chat models for this key. Connect a provider in the dashboard first.");
  if (opts.all) return models;
  if (opts.models?.length) return findModels(models, opts.models);
  if (!deps.isTTY) throw new SetupError("Choose models with --models <id,id> or --all.");
  deps.log("Models served by LiteRouter:");
  listModels(models, deps.log);
  for (;;) {
    const answer = await deps.prompt("Models to add (e.g. 1,3,5-7 or all): ");
    const picked = parseSelection(answer, models.length);
    if (picked) return picked.map((i) => models[i]);
    deps.log(`Enter numbers between 1 and ${models.length}, ranges like 2-4, or "all".`);
  }
}

async function pickOne(models, id, label, deps, { optional = false } = {}) {
  if (id) return findModels(models, [id])[0];
  if (!deps.isTTY) {
    if (optional) return null;
    throw new SetupError(`Choose the ${label} with --model <id>.`);
  }
  if (models.length === 0) throw new SetupError("The server lists no chat models for this key. Connect a provider in the dashboard first.");
  for (;;) {
    const suffix = optional ? ", Enter to skip" : "";
    const answer = String(await deps.prompt(`Number for the ${label}${suffix}: `)).trim();
    if (!answer && optional) return null;
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= models.length) return models[n - 1];
    deps.log(`Enter a number between 1 and ${models.length}.`);
  }
}

function readTextFile(fsImpl, filePath) {
  try {
    return fsImpl.readFileSync(filePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

function parseJsonConfig(text, filePath, { allowTrailingCommas = false } = {}) {
  if (text === null || text.trim() === "") return {};
  const source = allowTrailingCommas ? text.replace(/,(\s*[}\]])/g, "$1") : text;
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (err) {
    throw new SetupError(`${filePath} is not valid JSON (${err.message}). Fix or move it, then run setup again; nothing was changed.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SetupError(`${filePath} does not hold a JSON object; nothing was changed.`);
  }
  return parsed;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function timestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function writeConfigFile(filePath, content, previous, deps) {
  const fsImpl = deps.fs;
  const dir = path.dirname(filePath);
  fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let backupPath = null;
  if (previous !== null) {
    backupPath = `${filePath}.bak-${timestamp(deps.now())}`;
    for (let n = 1; fsImpl.existsSync(backupPath); n++) backupPath = `${filePath}.bak-${timestamp(deps.now())}-${n}`;
    fsImpl.writeFileSync(backupPath, previous, { mode: 0o600 });
    fsImpl.chmodSync(backupPath, 0o600);
  }
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  try {
    fsImpl.writeFileSync(tmpPath, content, { mode: 0o600 });
    fsImpl.chmodSync(tmpPath, 0o600);
    fsImpl.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      fsImpl.unlinkSync(tmpPath);
    } catch {}
    throw err;
  }
  return backupPath;
}

function defaultDeps(overrides = {}) {
  const input = require("../utils/input");
  return {
    fs,
    fetch: globalThis.fetch,
    env: process.env,
    home: os.homedir(),
    platform: process.platform,
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    prompt: input.prompt,
    confirm: input.confirm,
    promptSecret: promptHidden,
    log: console.log,
    error: console.error,
    now: () => new Date(),
    ...overrides,
  };
}

module.exports = {
  PROVIDER_KEY,
  DEFAULT_URL,
  SetupError,
  parseSetupArgs,
  normalizeBaseUrl,
  serverRoot,
  maskKey,
  maskText,
  resolveApiKey,
  fetchModels,
  modelInfo,
  parseSelection,
  listModels,
  pickMany,
  pickOne,
  readTextFile,
  parseJsonConfig,
  isPlainObject,
  writeConfigFile,
  defaultDeps,
};
