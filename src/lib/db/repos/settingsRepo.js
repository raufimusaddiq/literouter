import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";
const REMOVED_SETTINGS = new Set([
  "tunnelEnabled", "tunnelUrl", "tunnelProvider", "tailscaleEnabled",
  "tailscaleUrl", "tunnelDashboardAccess", "mitmRouterBaseUrl", "mitmSudoEncrypted",
]);

function withoutRemovedSettings(settings) {
  const next = { ...settings };
  for (const key of REMOVED_SETTINGS) delete next[key];
  return next;
}

const DEFAULT_SETTINGS = {
  cloudEnabled: false,
  stickyRoundRobinLimit: 3,
  providerStrategies: {},
  quotaVisibility: {},
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {},
  capacityAdapter: {
    vision: { enabled: true, roundRobin: false, models: [] },
    pdf: { enabled: false, roundRobin: false, models: [] },
    audioInput: { enabled: true, roundRobin: false, models: [] },
    videoInput: { enabled: false, roundRobin: false, models: [] },
  },
  requireLogin: true,
  requireApiKey: true,
  enableObservability: false,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 5,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  dnsToolEnabled: {},
  rtkEnabled: true,
  headroomEnabled: false,
  headroomUrl: DEFAULT_HEADROOM_URL,
  headroomCompressUserMessages: false,
  headroomTimeoutMs: 3000,
  cavemanEnabled: false,
  cavemanLevel: "full",
  ponytailEnabled: false,
  ponytailLevel: "full",
  pxpipeEnabled: false,
  pxpipeAutoInstall: true,
  pxpipeMinChars: 25000,
  pxpipeTimeoutMs: 15000,
};

async function readRaw() {
  // ponytail: process-local cache, invalidated on write; add Redis version key if multi-process writes appear
  const cache = global.__liteRouterSettingsCache ??= { raw: null, merged: null };
  if (cache.raw) return cache.raw;
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  cache.raw = row ? parseJson(row.data, {}) : {};
  return cache.raw;
}

// Merge raw settings with defaults; backward-compat for missing keys
export function mergeWithDefaults(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
    if (merged[key] === undefined) {
      if (
        key === "outboundProxyEnabled" &&
        typeof merged.outboundProxyUrl === "string" &&
        merged.outboundProxyUrl.trim()
      ) {
        merged[key] = true;
      } else {
        merged[key] = defVal;
      }
    }
  }
  return merged;
}

export async function getSettings() {
  // Cache the merged object too: mergeWithDefaults + raw parse dominated the
  // call cost, and every caller only reads the result.
  const cache = global.__liteRouterSettingsCache ??= { raw: null, merged: null };
  if (!cache.merged) cache.merged = mergeWithDefaults(await readRaw());
  return cache.merged;
}

// Atomic read-merge-write inside transaction (prevents losing concurrent updates)
export async function updateSettings(updates) {
  const db = await getAdapter();
  let next;
  db.transaction(function () {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = row ? parseJson(row.data, {}) : {};
    next = withoutRemovedSettings({ ...current, ...updates });
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)],
    );
  });
  const cache = (global.__liteRouterSettingsCache ??= { raw: null, merged: null });
  cache.raw = next;
  cache.merged = mergeWithDefaults(next);
  return cache.merged;
}

export async function isCloudEnabled() {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

export async function getCloudUrl() {
  const settings = await getSettings();
  return (
    settings.cloudUrl ||
    process.env.CLOUD_URL ||
    process.env.NEXT_PUBLIC_CLOUD_URL ||
    ""
  );
}

export async function exportSettings() {
  return withoutRemovedSettings(await readRaw());
}
