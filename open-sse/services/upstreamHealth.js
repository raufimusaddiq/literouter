import { createTtlLruMap } from "../utils/ttlLruMap.js";
import { parseModel, resolveProviderAlias } from "./model.js";
import {
  UPSTREAM_HEALTH_WINDOW_MS,
  UPSTREAM_HEALTH_DEGRADE_BASE_MS,
  UPSTREAM_HEALTH_DEGRADE_MAX_MS,
  UPSTREAM_HEALTH_SLOW_TTFT_MS,
  UPSTREAM_HEALTH_STALL_THRESHOLD,
} from "../config/runtimeConfig.js";

const HEALTH_STORE_TTL_MS = 15 * 60 * 1000;
const HEALTH_STORE_SWEEP_MS = 5 * 60 * 1000;
const EWMA_ALPHA = 0.25;
const SLOW_MIN_SAMPLES = 3;

const healthStore = createTtlLruMap("combo:upstreamHealth", {
  maxSize: 500,
  ttlMs: HEALTH_STORE_TTL_MS,
  cleanupIntervalMs: HEALTH_STORE_SWEEP_MS,
});

export function normalizeHealthKey(providerOrModelStr, model) {
  if (model) {
    return `${resolveProviderAlias(providerOrModelStr)}/${model}`;
  }
  if (typeof providerOrModelStr === "string" && providerOrModelStr.includes("/")) {
    const parsed = parseModel(providerOrModelStr);
    if (parsed.provider && parsed.model) {
      return `${parsed.provider}/${parsed.model}`;
    }
    return providerOrModelStr;
  }
  return providerOrModelStr || "";
}

function emptyHealthEntry() {
  return {
    stalls: [],
    ewmaTtftMs: null,
    samples: 0,
    degradedUntil: 0,
    degradeCount: 0,
    lastReason: null,
  };
}

export function getUpstreamHealth(providerOrModelStr, model, now = Date.now()) {
  const key = normalizeHealthKey(providerOrModelStr, model);
  if (!key) {
    return {
      key: "",
      degraded: false,
      degradedUntil: 0,
      slow: false,
      ewmaTtftMs: null,
      recentStalls: 0,
      lastReason: null,
      tier: 0,
    };
  }
  const entry = healthStore.peek(key, now);
  const recentStalls = entry
    ? entry.stalls.filter((t) => now - t <= UPSTREAM_HEALTH_WINDOW_MS).length
    : 0;
  const degraded = Boolean(entry?.degradedUntil && entry.degradedUntil > now);
  const slow = !degraded &&
    (entry?.samples || 0) >= SLOW_MIN_SAMPLES &&
    (entry?.ewmaTtftMs || 0) >= UPSTREAM_HEALTH_SLOW_TTFT_MS;
  return {
    key,
    degraded,
    degradedUntil: degraded ? entry.degradedUntil : 0,
    slow,
    ewmaTtftMs: entry?.ewmaTtftMs ?? null,
    recentStalls,
    lastReason: entry?.lastReason || null,
    tier: degraded ? 2 : (slow ? 1 : 0),
  };
}

export function recordUpstreamStall(provider, model, { reason = "stall_timeout", immediate = false, now = Date.now() } = {}) {
  const key = normalizeHealthKey(provider, model);
  if (!key) return null;
  const entry = healthStore.get(key, now) || emptyHealthEntry();
  entry.stalls = entry.stalls.filter((t) => now - t <= UPSTREAM_HEALTH_WINDOW_MS);
  entry.stalls.push(now);
  entry.lastReason = reason;
  if (immediate || entry.stalls.length >= UPSTREAM_HEALTH_STALL_THRESHOLD) {
    entry.degradeCount = Math.min((entry.degradeCount || 0) + 1, 6);
    const cooldown = Math.min(
      UPSTREAM_HEALTH_DEGRADE_BASE_MS * Math.pow(2, entry.degradeCount - 1),
      UPSTREAM_HEALTH_DEGRADE_MAX_MS,
    );
    entry.degradedUntil = Math.max(entry.degradedUntil || 0, now + cooldown);
  }
  healthStore.set(key, entry, now);
  return getUpstreamHealth(key, undefined, now);
}

export function recordUpstreamSuccess(provider, model, ttftMs, now = Date.now()) {
  const key = normalizeHealthKey(provider, model);
  if (!key || !Number.isFinite(ttftMs) || ttftMs <= 0) return;
  const entry = healthStore.get(key, now) || emptyHealthEntry();
  entry.samples = (entry.samples || 0) + 1;
  entry.ewmaTtftMs = entry.ewmaTtftMs === null
    ? ttftMs
    : entry.ewmaTtftMs * (1 - EWMA_ALPHA) + ttftMs * EWMA_ALPHA;
  if (ttftMs < UPSTREAM_HEALTH_SLOW_TTFT_MS) {
    entry.degradeCount = 0;
    entry.degradedUntil = 0;
    entry.stalls = [];
    entry.lastReason = null;
  }
  healthStore.set(key, entry, now);
}

export function reorderByUpstreamHealth(models, now = Date.now()) {
  if (!Array.isArray(models) || models.length <= 1) return models;
  const ranked = models.map((model, index) => ({
    model,
    index,
    health: getUpstreamHealth(model, undefined, now),
  }));
  if (ranked.every((item) => item.health.tier === 0)) {
    return models;
  }
  ranked.sort((a, b) => {
    if (a.health.tier !== b.health.tier) return a.health.tier - b.health.tier;
    if (a.health.tier === 1) {
      const aTtft = a.health.ewmaTtftMs ?? Infinity;
      const bTtft = b.health.ewmaTtftMs ?? Infinity;
      if (aTtft !== bTtft) return aTtft - bTtft;
    }
    return a.index - b.index;
  });
  return ranked.map((item) => item.model);
}

export function resetUpstreamHealth(providerOrModelStr, model) {
  if (providerOrModelStr) {
    const key = normalizeHealthKey(providerOrModelStr, model);
    if (key) healthStore.delete(key);
    return;
  }
  healthStore.clear();
}
