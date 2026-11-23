import { getAdapter, getAdapterSync } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const DEFAULT_MAX_RECORDS = 15000;
const MAX_RECORDS_CEILING = 100000;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024;
const DEFAULT_MAX_BUFFERED = 500;
const CONFIG_CACHE_TTL_MS = 5000;

export function resolveMaxRecords(settings = {}, env = process.env) {
  const fromEnv = Number.parseInt(env.OBSERVABILITY_MAX_RECORDS, 10);
  const fromSettings = Number(settings.observabilityMaxRecords);
  const n = fromEnv > 0 ? fromEnv : (fromSettings > 0 ? fromSettings : DEFAULT_MAX_RECORDS);
  return Math.min(Math.floor(n), MAX_RECORDS_CEILING);
}

let cachedConfig = null;
let cachedConfigTs = 0;

async function getObservabilityConfig() {
  if (cachedConfig && (Date.now() - cachedConfigTs) < CONFIG_CACHE_TTL_MS) return cachedConfig;
  try {
    const { getSettings } = await import("./settingsRepo.js");
    const settings = await getSettings();
    const envRequestLogs = process.env.ENABLE_REQUEST_LOGS;
    if (envRequestLogs !== undefined) {
      const enabled = envRequestLogs.toLowerCase() === "true";
      cachedConfig = {
        enabled,
        maxRecords: resolveMaxRecords(settings),
        batchSize: settings.observabilityBatchSize || parseInt(process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10),
        flushIntervalMs: settings.observabilityFlushIntervalMs || parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || String(DEFAULT_FLUSH_INTERVAL_MS), 10),
        maxJsonSize: (settings.observabilityMaxJsonSize || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "5", 10)) * 1024,
        maxBuffered: settings.observabilityMaxBuffered || parseInt(process.env.OBSERVABILITY_MAX_BUFFERED || String(DEFAULT_MAX_BUFFERED), 10),
      };
      cachedConfigTs = Date.now();
      return cachedConfig;
    }
    const envFallback = process.env.OBSERVABILITY_ENABLED !== "false";
    const uiFlag = typeof settings.enableObservability === "boolean";
    const enabled = uiFlag
      ? settings.enableObservability
      : envFallback;

    cachedConfig = {
      enabled,
      maxRecords: resolveMaxRecords(settings),
      batchSize: settings.observabilityBatchSize || parseInt(process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10),
      flushIntervalMs: settings.observabilityFlushIntervalMs || parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || String(DEFAULT_FLUSH_INTERVAL_MS), 10),
      maxJsonSize: (settings.observabilityMaxJsonSize || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "5", 10)) * 1024,
      maxBuffered: settings.observabilityMaxBuffered || parseInt(process.env.OBSERVABILITY_MAX_BUFFERED || String(DEFAULT_MAX_BUFFERED), 10),
    };
  } catch {
    cachedConfig = {
      enabled: false,
      maxRecords: DEFAULT_MAX_RECORDS,
      batchSize: DEFAULT_BATCH_SIZE,
      flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
      maxJsonSize: DEFAULT_MAX_JSON_SIZE,
      maxBuffered: DEFAULT_MAX_BUFFERED,
    };
  }
  cachedConfigTs = Date.now();
  return cachedConfig;
}

const bufferState = (globalThis.__liteRouterDetailBuffer ||= {
  writeBuffer: [],
  flushTimer: null,
  isFlushing: false,
  syncAdapter: null,
  maxRecords: DEFAULT_MAX_RECORDS,
});

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const sensitiveKeys = ["authorization", "x-api-key", "cookie", "token", "api-key"];
  const sanitized = { ...headers };
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) delete sanitized[key];
  }
  return sanitized;
}

export const __test__ = { sanitizeHeaders, boundField };

export const __buffer__ = { size: () => bufferState.writeBuffer.length };

function generateDetailId(model) {
  const timestamp = new Date().toISOString();
  const random = Math.random().toString(36).substring(2, 8);
  const modelPart = model ? model.replace(/[^a-zA-Z0-9-]/g, "-") : "unknown";
  return `${timestamp}-${random}-${modelPart}`;
}

const BASE64_MIN_LEN = 1024;
const BINARY_KEYS = new Set(["data", "b64_json", "base64", "bytes", "image", "audio", "file_data"]);
const BASE64_SNIFF = /^[A-Za-z0-9+/=\r\n_-]{256}/;
const PREVIEW_CHARS = 200;
const MAX_WALK_DEPTH = 64;

function isBulkBase64(str, key) {
  if (str.length < BASE64_MIN_LEN) return false;
  if (str.startsWith("data:") && str.slice(0, 100).includes(";base64,")) return true;
  return key !== undefined && BINARY_KEYS.has(key) && BASE64_SNIFF.test(str);
}

function imageMarker(str) {
  return `[image ${str.length} bytes]`;
}

function estimateSize(value, limit, depth = 0, key) {
  if (value === null || value === undefined) return 4;
  const t = typeof value;
  if (t === "string") return isBulkBase64(value, key) ? imageMarker(value).length + 2 : value.length + 2;
  if (t === "number" || t === "boolean") return 8;
  if (t !== "object" || depth > MAX_WALK_DEPTH) return 8;
  let size = 2;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      size += estimateSize(value[i], limit - size, depth + 1) + 1;
      if (size > limit) return size;
    }
    return size;
  }
  for (const key of Object.keys(value)) {
    size += key.length + 4 + estimateSize(value[key], limit - size, depth + 1, key);
    if (size > limit) return size;
  }
  return size;
}

function copyWithoutImages(value, depth = 0, key) {
  if (typeof value === "string") return isBulkBase64(value, key) ? imageMarker(value) : value;
  if (value === null || typeof value !== "object" || depth > MAX_WALK_DEPTH) return value;
  if (Array.isArray(value)) return value.map((v) => copyWithoutImages(v, depth + 1));
  const out = {};
  for (const key of Object.keys(value)) out[key] = copyWithoutImages(value[key], depth + 1, key);
  return out;
}

function skeleton(value, depth = 0, key) {
  if (typeof value === "string") return isBulkBase64(value, key) ? imageMarker(value) : value.slice(0, 80);
  if (value === null || typeof value !== "object" || depth > 4) return value;
  if (Array.isArray(value)) return value.slice(0, 3).map((v) => skeleton(v, depth + 1));
  const out = {};
  for (const key of Object.keys(value).slice(0, 8)) out[key] = skeleton(value[key], depth + 1, key);
  return out;
}

export function boundField(obj, maxSize) {
  if (obj === null || obj === undefined) return {};
  if (typeof obj === "string") {
    if (isBulkBase64(obj)) return imageMarker(obj);
    if (obj.length <= maxSize) return obj;
    return { _truncated: true, _originalSize: obj.length, _preview: obj.substring(0, PREVIEW_CHARS) };
  }
  if (typeof obj !== "object") return obj;
  const size = estimateSize(obj, maxSize);
  if (size <= maxSize) return copyWithoutImages(obj);
  let preview = "";
  try { preview = JSON.stringify(skeleton(obj)).substring(0, PREVIEW_CHARS); } catch {}
  return { _truncated: true, _originalSize: size, _preview: preview };
}

function buildDetailRecord(item, maxJsonSize) {
  if (!item.id) item.id = generateDetailId(item.model);
  if (!item.timestamp) item.timestamp = new Date().toISOString();
  const headers = item.request?.headers ? sanitizeHeaders(item.request.headers) : null;
  const request = headers ? { ...item.request, headers } : item.request;
  return {
    id: item.id,
    provider: item.provider || null,
    model: item.model || null,
    connectionId: item.connectionId || null,
    timestamp: item.timestamp,
    status: item.status || null,
    latency: item.latency || {},
    tokens: item.tokens || {},
    request: boundField(request, maxJsonSize),
    providerRequest: boundField(item.providerRequest, maxJsonSize),
    providerResponse: boundField(item.providerResponse, maxJsonSize),
    response: boundField(item.response, maxJsonSize),
    pxpipe: item.pxpipe || undefined,
  };
}

function requeueFailed(items, maxBuffered) {
  const merged = items.concat(bufferState.writeBuffer);
  const cap = maxBuffered > 0 ? maxBuffered : DEFAULT_MAX_BUFFERED;
  bufferState.writeBuffer.splice(0, bufferState.writeBuffer.length, ...merged.slice(-cap));
}

const UPSERT_SQL = `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET timestamp = excluded.timestamp, provider = excluded.provider, model = excluded.model, connectionId = excluded.connectionId, status = excluded.status, data = excluded.data`;
const FLUSH_CHUNK = 20;

function writeRecords(db, records, maxRecords) {
  db.transaction(() => {
    for (const record of records) {
      db.run(UPSERT_SQL, [record.id, record.timestamp, record.provider, record.model, record.connectionId, record.status, stringifyJson(record)]);
    }
    const cnt = db.get(`SELECT COUNT(*) as c FROM requestDetails`);
    if (cnt && cnt.c > maxRecords) {
      db.run(
        `DELETE FROM requestDetails WHERE id IN (SELECT id FROM requestDetails ORDER BY timestamp ASC LIMIT ?)`,
        [cnt.c - maxRecords]
      );
    }
  });
}

async function flushToDatabase() {
  if (bufferState.isFlushing) return;
  if (bufferState.writeBuffer.length === 0) return;
  bufferState.isFlushing = true;
  try {
    while (bufferState.writeBuffer.length > 0) {
      const items = bufferState.writeBuffer.splice(0, FLUSH_CHUNK);
      let config = null;
      try {
        const db = await getAdapter();
        config = await getObservabilityConfig();
        writeRecords(db, items, config.maxRecords);
      } catch (e) {
        requeueFailed(items, config?.maxBuffered);
        throw e;
      }
      if (bufferState.writeBuffer.length > 0) await new Promise((resolve) => setImmediate(resolve));
    }
  } catch (e) {
    console.error("[requestDetailsRepo] Batch write failed (batch re-queued):", e);
  } finally {
    bufferState.isFlushing = false;
  }
}

export async function saveRequestDetail(detail) {
  const config = await getObservabilityConfig();
  if (!config.enabled) {return;}

  ensureShutdownHandler();

  try {
    if (!bufferState.syncAdapter) bufferState.syncAdapter = getAdapterSync();
    bufferState.maxRecords = config.maxRecords || DEFAULT_MAX_RECORDS;
    bufferState.maxJsonSize = config.maxJsonSize || DEFAULT_MAX_JSON_SIZE;
  } catch {
  }

  if (bufferState.writeBuffer.length >= config.maxBuffered) {
    const dropped = bufferState.writeBuffer.shift();
    if (!dropped.__overflowLogged) {
      dropped.__overflowLogged = true;
      console.error(
        `[requestDetailsRepo] write buffer full (${config.maxBuffered}); dropping oldest detail(s) until the DB catches up`
      );
    }
  }

  const record = buildDetailRecord(detail, config.maxJsonSize || DEFAULT_MAX_JSON_SIZE);
  const existing = bufferState.writeBuffer.findIndex((r) => r.id === record.id);
  if (existing !== -1) bufferState.writeBuffer[existing] = record;
  else bufferState.writeBuffer.push(record);

  if (bufferState.writeBuffer.length >= config.batchSize) {
    if (bufferState.flushTimer) { clearTimeout(bufferState.flushTimer); bufferState.flushTimer = null; }
    flushToDatabase().catch((e) => console.error("[requestDetailsRepo] flush err:", e));
  } else if (!bufferState.flushTimer) {
    bufferState.flushTimer = setTimeout(() => {
      bufferState.flushTimer = null;
      flushToDatabase().catch(() => {});
    }, config.flushIntervalMs);
  }
}

export async function flushRequestDetails() {
  if (bufferState.writeBuffer.length === 0) return true;
  if (bufferState.flushTimer) { clearTimeout(bufferState.flushTimer); bufferState.flushTimer = null; }
  drainSync();
  return bufferState.writeBuffer.length === 0;
}

export async function getRequestDetails(filter = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];

  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.connectionId) { conds.push("connectionId = ?"); params.push(filter.connectionId); }
  if (filter.status) { conds.push("status = ?"); params.push(filter.status); }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const cntRow = db.get(`SELECT COUNT(*) as c FROM requestDetails ${where}`, params);
  const totalItems = cntRow ? cntRow.c : 0;

  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  const totalPages = Math.ceil(totalItems / pageSize);
  const offset = (page - 1) * pageSize;

  const rows = db.all(
    `SELECT data FROM requestDetails ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const details = rows.map((r) => parseJson(r.data, {}));

  return {
    details,
    pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

export async function getDistinctProviders() {
  const db = await getAdapter();
  const rows = db.all(`SELECT DISTINCT provider FROM requestDetails WHERE provider IS NOT NULL ORDER BY provider ASC`);
  return rows.map((r) => r.provider);
}

export async function getRequestDetailById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM requestDetails WHERE id = ?`, [id]);
  return row ? parseJson(row.data, null) : null;
}

function drainSync() {
  if (bufferState.writeBuffer.length === 0) return;
  try {
    const db = bufferState.syncAdapter || getAdapterSync();
    const items = bufferState.writeBuffer.splice(0, bufferState.writeBuffer.length);
    try {
      writeDetailsSync(db, items);
    } catch (e) {
      requeueFailed(items, cachedConfig?.maxBuffered);
      throw e;
    }
  } catch (e) {
    console.error("[requestDetailsRepo] sync drain failed:", e);
  }
}

globalThis.__liteRouterDrainSync = drainSync;

function writeDetailsSync(db, items) {
  writeRecords(db, items, bufferState.maxRecords || DEFAULT_MAX_RECORDS);
}

export function ensureShutdownHandler() {
  if (globalThis.__liteRouterDetailShutdownHook) return;
  globalThis.__liteRouterDetailShutdownHook = true;
  process.on("beforeExit", drainSync);
  process.on("SIGINT", drainSync);
  process.on("SIGTERM", drainSync);
}
