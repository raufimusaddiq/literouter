// Daily refresh of Kenari's own model list (public, unauthenticated).
//
// Kenari publishes authoritative context/output limits and modalities for every
// model it serves; the hand-written tables drift from it. This keeps a compact
// copy next to the database for open-sse/providers/kenariCatalog.js to read.
// Always on (one small public request a day, no credentials, nothing to gate it
// on), with KENARI_CATALOG_SYNC=off as a kill switch. Failures are swallowed on
// purpose: a stale or missing file just means the existing tables decide.

import fs from "node:fs";
import path from "node:path";
import {
  KENARI_CATALOG_FILE,
  KENARI_CATALOG_VERSION,
  invalidateKenariCatalog,
} from "open-sse/providers/kenariCatalog.js";

export const KENARI_MODELS_URL = "https://kenari.id/v1/models";
const FETCH_TIMEOUT_MS = 30000;
export const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 60 * 1000;
const RETRY_DELAY_MS = 30 * 60 * 1000;

// Kenari endpoint -> kind. "music" is audio output with no LLM-list meaning; the
// /v1/models resolver files it with the non-LLM audio kinds.
const KIND_BY_ENDPOINT = {
  chat: "llm",
  images: "image",
  audio_speech: "tts",
  audio_transcription: "stt",
  videos: "video",
  music: "music",
};

const positive = (n) => (Number.isFinite(n) && n > 0 ? n : undefined);

function kindOf(m) {
  const endpoints = Array.isArray(m.endpoints) ? m.endpoints : [];
  for (const endpoint of endpoints) {
    if (Object.hasOwn(KIND_BY_ENDPOINT, endpoint)) return KIND_BY_ENDPOINT[endpoint];
  }
  const out = Array.isArray(m.modalities?.output) ? m.modalities.output : [];
  if (out.includes("text")) return "llm";
  if (out.includes("image")) return "image";
  if (out.includes("video")) return "video";
  if (out.includes("audio")) return "tts";
  return undefined;
}

// Kenari response body -> { [modelId]: compact entry }. Only fields actually
// present are kept; entries without a usable id are dropped.
export function normalizeKenariModels(body) {
  const list = Array.isArray(body) ? body : body?.data;
  if (!Array.isArray(list)) return {};
  const pairs = [];
  for (const m of list) {
    if (!m || typeof m.id !== "string" || !m.id) continue;
    const entry = {};
    if (typeof m.name === "string" && m.name) entry.name = m.name;
    const kind = kindOf(m);
    if (kind) entry.kind = kind;
    const contextWindow = positive(m.context_length);
    if (contextWindow) entry.contextWindow = contextWindow;
    const maxOutput = positive(m.max_output_tokens);
    if (maxOutput) entry.maxOutput = maxOutput;
    const input = Array.isArray(m.modalities?.input) ? m.modalities.input : [];
    if (input.includes("image")) entry.vision = true;
    if (input.includes("pdf")) entry.pdf = true;
    if (input.includes("audio")) entry.audioInput = true;
    if (input.includes("video")) entry.videoInput = true;
    if (typeof m.reasoning === "boolean") entry.reasoning = m.reasoning;
    if (typeof m.tool_call === "boolean") entry.tools = m.tool_call;
    pairs.push([m.id, entry]);
  }
  // fromEntries defines own properties, so an id like "__proto__" cannot reach
  // the prototype.
  return Object.fromEntries(pairs);
}

function writeAtomic(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, contents, "utf8");
  fs.renameSync(`${file}.tmp`, file);
}

let state = { running: false, lastSync: null, lastError: null, lastResult: null };
let timer = null;

export function getKenariSyncState() {
  return { ...state, file: KENARI_CATALOG_FILE, url: KENARI_MODELS_URL, intervalMs: SYNC_INTERVAL_MS };
}

// Run one sync. Returns a summary, or null when it could not complete.
export async function syncKenariCatalog() {
  if (state.running) return null;
  state.running = true;
  try {
    const response = await fetch(KENARI_MODELS_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const models = normalizeKenariModels(await response.json());
    const count = Object.keys(models).length;
    // An empty list is an upstream hiccup, not a catalog: keep the last good file.
    if (!count) throw new Error("no models in response");

    const serialized = JSON.stringify({ v: KENARI_CATALOG_VERSION, syncedAt: Date.now(), models });
    writeAtomic(KENARI_CATALOG_FILE, serialized);
    invalidateKenariCatalog();

    const result = { status: "updated", models: count, bytes: Buffer.byteLength(serialized) };
    console.log(`[kenariCatalog] ${count} models, ${(result.bytes / 1024).toFixed(1)}KB`);
    state.lastSync = Date.now();
    state.lastError = null;
    state.lastResult = result;
    return result;
  } catch (error) {
    state.lastError = error?.message || String(error);
    console.log(`[kenariCatalog] sync failed: ${state.lastError}`);
    return null;
  } finally {
    state.running = false;
  }
}

// Schedule the recurring sync. Disable entirely with KENARI_CATALOG_SYNC=off.
export function startKenariCatalogSync() {
  if (timer) return;
  if (String(process.env.KENARI_CATALOG_SYNC || "").toLowerCase() === "off") return;

  const schedule = (delay) => {
    timer = setTimeout(async () => {
      const result = await syncKenariCatalog();
      schedule(result ? SYNC_INTERVAL_MS : RETRY_DELAY_MS);
    }, delay);
    timer.unref?.();
  };
  schedule(STARTUP_DELAY_MS);
}
