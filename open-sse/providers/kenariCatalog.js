// Read side of the Kenari model catalog (written daily by
// src/lib/modelCatalog/kenariSync.js from https://kenari.id/v1/models).
//
// Kenari is the authority on its own gateway's limits and modalities, so for the
// `kenari` provider these numbers outrank every hand-written table and the
// models.dev overlay. Like catalogOverride.js, the file is the source of truth and
// the parsed copy is dropped when its mtime changes. Every failure (missing file,
// corrupt JSON, wrong shape) resolves to "no data" so the existing tables decide.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";

export const KENARI_CATALOG_FILE = path.join(DATA_DIR, "kenari-catalog.json");
export const KENARI_CATALOG_VERSION = 1;

const EMPTY = Object.freeze({});
let cache = EMPTY;
let cachedMtime = -1;
let cachedFile = null;

// The file path is a parameter only so tests can point at a temp file.
let file = KENARI_CATALOG_FILE;
export function setKenariCatalogFile(next) {
  file = next || KENARI_CATALOG_FILE;
  invalidateKenariCatalog();
}

function load() {
  let mtime;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    cache = EMPTY;
    cachedMtime = -1;
    return cache;
  }
  if (mtime === cachedMtime && cachedFile === file) return cache;

  cachedMtime = mtime;
  cachedFile = file;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const models = parsed?.models;
    cache = models && typeof models === "object" && !Array.isArray(models) ? models : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

export function invalidateKenariCatalog() {
  cachedMtime = -1;
  cachedFile = null;
}

// Model ids are untrusted request input: own-property reads only, so "constructor"
// or "__proto__" never resolve to something inherited.
function entryFor(model) {
  if (typeof model !== "string" || !model) return null;
  const table = load();
  // Exact id first: "glm-4-7-flash:free" is its own entry, distinct from
  // "glm-4-7-flash". Variants are deliberately NOT stripped to a base id.
  if (Object.hasOwn(table, model)) return table[model] || null;
  const bare = (model.includes("/") ? model.split("/").pop() : model).toLowerCase();
  if (bare !== model && Object.hasOwn(table, bare)) return table[bare] || null;
  return null;
}

const LIMIT_KEYS = ["contextWindow", "maxOutput"];
const MODALITY_KEYS = ["vision", "pdf", "audioInput", "videoInput"];

// What capabilities.js applies for provider "kenari": positive limits, and
// modalities that are declared true. Returns null when nothing is known.
export function getKenariLive(model) {
  const entry = entryFor(model);
  if (!entry || typeof entry !== "object") return null;
  const out = {};
  for (const key of LIMIT_KEYS) if (entry[key] > 0) out[key] = entry[key];
  for (const key of MODALITY_KEYS) if (entry[key] === true) out[key] = true;
  return Object.keys(out).length ? out : null;
}

// Cached catalog as a model list, or null when there is no usable cache.
export function listKenariModels() {
  const table = load();
  const ids = Object.keys(table);
  if (!ids.length) return null;
  return ids.map((id) => ({ id, ...table[id] }));
}

// Hook handed to capabilities.js by catalogOverride.js's installCatalogSource()
// (capabilities.js is bundled into the browser too, so it cannot import this).
export function getKenariProviderLive(provider, model) {
  return provider === "kenari" ? getKenariLive(model) : null;
}
