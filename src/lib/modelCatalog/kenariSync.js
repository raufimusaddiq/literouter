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

const KENARI_MODELS_URL = "https://kenari.id/v1/models";
const FETCH_TIMEOUT_MS = 30000;
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 60 * 1000;
const RETRY_DELAY_MS = 30 * 60 * 1000;

// Kenari endpoint -> kind (music is filed with tts: audio output, never an LLM).
const KIND_BY_ENDPOINT = {
  chat: "llm",
  images: "image",
  audio_speech: "tts",
  audio_transcription: "stt",
  videos: "video",
  music: "tts",
};

// Levels Kenari may advertise in supported_reasoning_levels; anything else is dropped.
const KNOWN_REASONING_LEVELS = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);

const positive = (n) => (Number.isFinite(n) && n > 0 ? n : undefined);

const kindOf = (m) => (Array.isArray(m.endpoints) ? m.endpoints : [])
  .map((endpoint) => (Object.hasOwn(KIND_BY_ENDPOINT, endpoint) ? KIND_BY_ENDPOINT[endpoint] : undefined))
  .find(Boolean);

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
    if (typeof m.reasoning_toggle === "boolean") entry.reasoningToggle = m.reasoning_toggle;
    if (Array.isArray(m.supported_reasoning_levels)) {
      const levels = [...new Set(m.supported_reasoning_levels.filter((l) => KNOWN_REASONING_LEVELS.has(l)))];
      if (levels.length) entry.reasoningLevels = levels;
    }
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

let running = false;
let timer = null;

// Run one sync. Returns a summary, or null when it could not complete.
export async function syncKenariCatalog() {
  if (running) return null;
  running = true;
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
    return result;
  } catch (error) {
    console.log(`[kenariCatalog] sync failed: ${error?.message || error}`);
    return null;
  } finally {
    running = false;
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
