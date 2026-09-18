import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024;
const DEFAULT_MAX_BUFFERED = 500;
const CONFIG_CACHE_TTL_MS = 5000;

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
        maxRecords: settings.observabilityMaxRecords || parseInt(process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS), 10),
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
      maxRecords: settings.observabilityMaxRecords || parseInt(process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS), 10),
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

// Next bundles this module once per route/entry, so module-level state is NOT
// shared. Anchor the queue on globalThis so every instance drains the same
// buffer and a shutdown flush sees rows written by request handlers.
const bufferState = (globalThis.__liteRouterDetailBuffer ||= {
  writeBuffer: [],
  flushTimer: null,
  isFlushing: false,
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

export const __test__ = { sanitizeHeaders };

// Read-only hook for the bounded-buffer check.
export const __buffer__ = { size: () => bufferState.writeBuffer.length };

function generateDetailId(model) {
  const timestamp = new Date().toISOString();
  const random = Math.random().toString(36).substring(2, 8);
  const modelPart = model ? model.replace(/[^a-zA-Z0-9-]/g, "-") : "unknown";
  return `${timestamp}-${random}-${modelPart}`;
}

function truncateField(obj, maxSize) {
  const str = JSON.stringify(obj || {});
  if (str.length > maxSize) {
    return { _truncated: true, _originalSize: str.length, _preview: str.substring(0, 200) };
  }
  return obj || {};
}

async function flushToDatabase() {
  if (bufferState.isFlushing) return;
  if (bufferState.writeBuffer.length === 0) return;
  bufferState.isFlushing = true;
  try {
    // Drain entire buffer (loop in case more pushed during await)
    while (bufferState.writeBuffer.length > 0) {
      const items = bufferState.writeBuffer.splice(0, bufferState.writeBuffer.length);
      const db = await getAdapter();
      const config = await getObservabilityConfig();

      db.transaction(() => {
        for (const item of items) {
          if (!item.id) item.id = generateDetailId(item.model);
          if (!item.timestamp) item.timestamp = new Date().toISOString();
          if (item.request?.headers) item.request.headers = sanitizeHeaders(item.request.headers);

          const record = {
            id: item.id,
            provider: item.provider || null,
            model: item.model || null,
            connectionId: item.connectionId || null,
            timestamp: item.timestamp,
            status: item.status || null,
            latency: item.latency || {},
            tokens: item.tokens || {},
            request: truncateField(item.request, config.maxJsonSize),
            providerRequest: truncateField(item.providerRequest, config.maxJsonSize),
            providerResponse: truncateField(item.providerResponse, config.maxJsonSize),
            response: truncateField(item.response, config.maxJsonSize),
            pxpipe: item.pxpipe || undefined,
          };

          db.run(
            `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET timestamp = excluded.timestamp, provider = excluded.provider, model = excluded.model, connectionId = excluded.connectionId, status = excluded.status, data = excluded.data`,
            [record.id, record.timestamp, record.provider, record.model, record.connectionId, record.status, stringifyJson(record)]
          );
        }

        const cnt = db.get(`SELECT COUNT(*) as c FROM requestDetails`);
        if (cnt && cnt.c > config.maxRecords) {
          db.run(
            `DELETE FROM requestDetails WHERE id IN (SELECT id FROM requestDetails ORDER BY timestamp ASC LIMIT ?)`,
            [cnt.c - config.maxRecords]
          );
        }
      });
    }
  } catch (e) {
    console.error("[requestDetailsRepo] Batch write failed:", e);
  } finally {
    bufferState.isFlushing = false;
  }
}

export async function saveRequestDetail(detail) {
  const config = await getObservabilityConfig();
  if (!config.enabled) {return;}

  ensureShutdownHandler();

  // ponytail: drop-oldest on overflow; switch to a Redis stream/disk spool if
  // losing observability rows under sustained DB stall becomes unacceptable.
  if (bufferState.writeBuffer.length >= config.maxBuffered) {
    const dropped = bufferState.writeBuffer.shift();
    if (!dropped.__overflowLogged) {
      dropped.__overflowLogged = true;
      console.error(
        `[requestDetailsRepo] write buffer full (${config.maxBuffered}); dropping oldest detail(s) until the DB catches up`
      );
    }
  }

  bufferState.writeBuffer.push(detail);

  // Trigger immediate flush if batch threshold reached.
  // flushToDatabase() drains entire buffer in a loop, so all pushes during await are persisted.
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

// Fixed-timeout drain for shutdown. Never blocks exit indefinitely; the caller
// gets false when the deadline hits with rows still buffered.
export async function flushRequestDetails(timeoutMs = 3000) {
  if (bufferState.writeBuffer.length === 0) return true;
  if (bufferState.flushTimer) { clearTimeout(bufferState.flushTimer); bufferState.flushTimer = null; }
  let timer = null;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const drained = flushToDatabase().then(() => (bufferState.writeBuffer.length === 0 ? "ok" : "timeout"));
  const result = await Promise.race([drained, deadline]);
  if (timer) clearTimeout(timer);
  return result === "ok";
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

const _shutdownHandler = async () => {
  if (bufferState.flushTimer) { clearTimeout(bufferState.flushTimer); bufferState.flushTimer = null; }
  if (bufferState.writeBuffer.length > 0) await flushToDatabase();
};

// Exported (not just called inline) so bundlers keep the handler reachable;
// an unreferenced module-level side effect gets tree-shaken out of the route.
export function ensureShutdownHandler() {
  if (globalThis.__liteRouterDetailShutdownHook) return;
  globalThis.__liteRouterDetailShutdownHook = true;
  process.on("beforeExit", _shutdownHandler);
  process.on("SIGINT", _shutdownHandler);
  process.on("SIGTERM", _shutdownHandler);
}
