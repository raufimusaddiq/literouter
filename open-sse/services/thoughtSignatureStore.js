import { makeKv, invalidateKvScope } from "../../src/lib/db/helpers/kvStore.js";
import { getAdapterSync } from "../../src/lib/db/driver.js";
import { stringifyJson } from "../../src/lib/db/helpers/jsonCol.js";

const MAX_SIGNATURES = 2000;
const MAX_PERSISTED_SIGNATURES = 10_000;
const MEMORY_TTL_MS = 1000 * 60 * 60;
const PERSISTED_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const SCOPE = "gemini_thought_signatures";

const signatureKv = makeKv(SCOPE);
const memorySignatures = new Map();

export function signatureFamily(model) {
  const m = typeof model === "string" ? model.toLowerCase() : "";
  if (!m) return null;
  if (m.includes("claude")) return "claude";
  if (m.includes("gemini")) return "gemini";
  return m;
}

function isCompatible(entry, family) {
  return !entry.family || !family || entry.family === family;
}

const MEMORY_PRUNE_INTERVAL_MS = 60 * 1000;
const PERSIST_FLUSH_INTERVAL_MS = 1000;
const PERSISTED_PRUNE_INTERVAL_MS = 10 * 60 * 1000;

function pruneMemoryExpired() {
  const now = Date.now();
  for (const [key, value] of memorySignatures.entries()) {
    if (value.expiresAt <= now) {
      memorySignatures.delete(key);
    }
  }
  trimMemoryToCap();
}

function trimMemoryToCap() {
  while (memorySignatures.size > MAX_SIGNATURES) {
    const oldestKey = memorySignatures.keys().next().value;
    if (oldestKey === undefined) break;
    memorySignatures.delete(oldestKey);
  }
}

const pendingPersist = new Map();
let flushTimer = null;
let pruneTimer = null;
let lastPersistedPruneAt = 0;

export async function flushPendingSignatures() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (pendingPersist.size === 0) return;
  const batch = Object.fromEntries(pendingPersist);
  pendingPersist.clear();
  try {
    await signatureKv.setMany(batch);
  } catch {
  }
}

export function flushPendingSignaturesSync() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (pendingPersist.size === 0) return;
  const batch = [...pendingPersist];
  pendingPersist.clear();
  const db = getAdapterSync();
  db.transaction(() => {
    for (const [k, v] of batch) {
      db.run(`INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`, [SCOPE, k, stringifyJson(v)]);
    }
  });
  invalidateKvScope(SCOPE);
}
globalThis.__liteRouterSignatureDrainSync = flushPendingSignaturesSync;

function ensureTimers() {
  if (!pruneTimer) {
    pruneTimer = setInterval(() => {
      pruneMemoryExpired();
      if (Date.now() - lastPersistedPruneAt >= PERSISTED_PRUNE_INTERVAL_MS) {
        lastPersistedPruneAt = Date.now();
        prunePersisted().catch(() => {});
      }
    }, MEMORY_PRUNE_INTERVAL_MS);
    pruneTimer.unref?.();
  }
}

function schedulePersistFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPendingSignatures().catch(() => {});
  }, PERSIST_FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
}

async function prunePersisted() {
  try {
    const all = await signatureKv.getAll({ clone: false });
    const now = Date.now();
    const toRemove = [];
    const valid = [];

    for (const k of Object.keys(all)) {
      const entry = all[k];
      if (!entry || typeof entry.signature !== "string" || (entry.expiresAt && entry.expiresAt <= now)) {
        toRemove.push(k);
      } else {
        valid.push({ key: k, createdAt: entry.createdAt || 0 });
      }
    }

    if (valid.length > MAX_PERSISTED_SIGNATURES) {
      valid.sort((x, y) => y.createdAt - x.createdAt);
      for (const item of valid.slice(MAX_PERSISTED_SIGNATURES)) toRemove.push(item.key);
    }
    await signatureKv.removeMany(toRemove);
  } catch {
  }
}

export function storeGeminiThoughtSignature(toolCallId, signature, sessionId = null, model = null) {
  if (typeof toolCallId !== "string" || !toolCallId) return;
  if (typeof signature !== "string" || !signature) return;

  const now = Date.now();
  const family = signatureFamily(model);
  ensureTimers();

  const keys = [];
  if (sessionId && typeof sessionId === "string") {
    keys.push(`${sessionId}:${toolCallId}`);
  }
  keys.push(toolCallId);

  for (const k of keys) {
    memorySignatures.delete(k);
    memorySignatures.set(k, {
      signature,
      family,
      expiresAt: now + MEMORY_TTL_MS,
    });
    pendingPersist.set(k, {
      signature,
      family,
      createdAt: now,
      expiresAt: now + PERSISTED_TTL_MS,
    });
  }
  trimMemoryToCap();
  schedulePersistFlush();
}

export function getGeminiThoughtSignatureSync(toolCallId, sessionId = null, model = null) {
  if (typeof toolCallId !== "string" || !toolCallId) return null;
  const family = signatureFamily(model);

  if (sessionId && typeof sessionId === "string") {
    const sessionKey = `${sessionId}:${toolCallId}`;
    const sessionEntry = memorySignatures.get(sessionKey);
    if (sessionEntry && sessionEntry.expiresAt > Date.now() && isCompatible(sessionEntry, family)) {
      return sessionEntry.signature;
    }
  }

  const entry = memorySignatures.get(toolCallId);
  if (entry && entry.expiresAt > Date.now() && isCompatible(entry, family)) {
    return entry.signature;
  }
  return null;
}
