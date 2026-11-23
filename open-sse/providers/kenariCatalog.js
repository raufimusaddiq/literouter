
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";

export const KENARI_CATALOG_FILE = path.join(DATA_DIR, "kenari-catalog.json");
export const KENARI_CATALOG_VERSION = 1;

const EMPTY = Object.freeze({});
let cache = EMPTY;
let cachedMtime = -1;

function load() {
  let mtime;
  try {
    mtime = fs.statSync(KENARI_CATALOG_FILE).mtimeMs;
  } catch {
    cache = EMPTY;
    cachedMtime = -1;
    return cache;
  }
  if (mtime === cachedMtime) return cache;

  cachedMtime = mtime;
  try {
    const parsed = JSON.parse(fs.readFileSync(KENARI_CATALOG_FILE, "utf8"));
    const models = parsed?.models;
    cache = models && typeof models === "object" && !Array.isArray(models) ? models : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

export function invalidateKenariCatalog() {
  cachedMtime = -1;
}

function entryFor(model) {
  if (typeof model !== "string" || !model) return null;
  const table = load();
  if (Object.hasOwn(table, model)) return table[model] || null;
  const bare = (model.includes("/") ? model.split("/").pop() : model).toLowerCase();
  if (bare !== model && Object.hasOwn(table, bare)) return table[bare] || null;
  const colon = bare.lastIndexOf(":");
  const base = colon > 0 && Object.hasOwn(table, bare.slice(0, colon)) ? table[bare.slice(0, colon)] : null;
  return Array.isArray(base?.reasoningLevels) && base.reasoningLevels.includes(bare.slice(colon + 1)) ? base : null;
}

const LIMIT_KEYS = ["contextWindow", "maxOutput"];
const MODALITY_KEYS = ["vision", "pdf", "audioInput", "videoInput"];

function getKenariLive(model) {
  const entry = entryFor(model);
  if (!entry || typeof entry !== "object") return null;
  const out = {};
  for (const key of LIMIT_KEYS) if (entry[key] > 0) out[key] = entry[key];
  for (const key of MODALITY_KEYS) if (entry[key] === true) out[key] = true;
  if (typeof entry.reasoning === "boolean") out.reasoning = entry.reasoning;
  if (typeof entry.reasoningToggle === "boolean") out.reasoningToggle = entry.reasoningToggle;
  if (Array.isArray(entry.reasoningLevels) && entry.reasoningLevels.length) out.reasoningLevels = entry.reasoningLevels;
  return Object.keys(out).length ? out : null;
}

export function listKenariModels() {
  const table = load();
  const ids = Object.keys(table);
  if (!ids.length) return null;
  return ids.map((id) => ({ id, ...table[id] }));
}

export function getKenariProviderLive(provider, model) {
  return provider === "kenari" ? getKenariLive(model) : null;
}
