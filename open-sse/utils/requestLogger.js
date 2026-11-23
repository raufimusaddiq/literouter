import { redactUrlSecrets } from "./redactUrl.js";
import { redactClientHeaders, redactUpstreamHeaders } from "./keyFingerprint.js";

const isNode = typeof process !== "undefined" && process.versions?.node && typeof window === "undefined";

const LOGGING_ENABLED = typeof process !== "undefined" && process.env?.ENABLE_REQUEST_LOGS === 'true';

let fs = null;
let path = null;
let LOGS_DIR = null;
const LOG_MAX_SESSIONS = Math.max(1, Number.parseInt(process.env.REQUEST_LOG_MAX_SESSIONS || "1000", 10));
const LOG_MAX_BYTES = Math.max(1, Number.parseInt(process.env.REQUEST_LOG_MAX_SIZE_MB || "1024", 10)) * 1024 * 1024;
const LOG_PRUNE_INTERVAL_MS = Math.max(0, Number.parseInt(process.env.REQUEST_LOG_PRUNE_INTERVAL_MS || "300000", 10));
let lastPruneAt = 0;
let sessionCount = 0;

async function ensureNodeModules() {
  if (!isNode || !LOGGING_ENABLED || fs) return;
  try {
    fs = await import("fs");
    path = await import("path");
    LOGS_DIR = path.join(typeof process !== "undefined" && process.cwd ? process.cwd() : ".", "logs");
  } catch {
  }
}

async function getDirectorySize(directory) {
  const entries = await fs.promises.readdir(/* turbopackIgnore: true */ directory, { withFileTypes: true });
  const sizes = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return getDirectorySize(entryPath);
    try { return (await fs.promises.stat(/* turbopackIgnore: true */ entryPath)).size; } catch { return 0; }
  }));
  return sizes.reduce((total, n) => total + n, 0);
}

let pruning = null;
const activeSessions = new Set();

function pruneLogSessions(force = false) {
  if (!fs || !LOGS_DIR || (!force && Date.now() - lastPruneAt < LOG_PRUNE_INTERVAL_MS)) return Promise.resolve();
  if (pruning) return pruning;
  lastPruneAt = Date.now();
  pruning = doPrune().finally(() => { pruning = null; });
  return pruning;
}

async function doPrune() {
  try {
    let dirents;
    try {
      dirents = await fs.promises.readdir(/* turbopackIgnore: true */ LOGS_DIR, { withFileTypes: true });
    } catch (err) {
      if (err.code === "ENOENT") { sessionCount = 0; return; }
      throw err;
    }
    const sessions = (await Promise.all(dirents
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const sessionPath = path.join(/* turbopackIgnore: true */ LOGS_DIR, entry.name);
        try {
          const stats = await fs.promises.stat(/* turbopackIgnore: true */ sessionPath);
          return { sessionPath, mtime: stats.mtimeMs, size: await getDirectorySize(sessionPath) };
        } catch { return null; }
      })))
      .filter(Boolean)
      .sort((a, b) => a.mtime - b.mtime || (a.sessionPath < b.sessionPath ? -1 : a.sessionPath > b.sessionPath ? 1 : 0));
    let totalBytes = sessions.reduce((total, session) => total + session.size, 0);

    while (sessions.length > LOG_MAX_SESSIONS || totalBytes > LOG_MAX_BYTES) {
      const index = sessions.findIndex((session) => !activeSessions.has(session.sessionPath));
      if (index === -1) break;
      const [oldest] = sessions.splice(index, 1);
      await fs.promises.rm(/* turbopackIgnore: true */ oldest.sessionPath, { recursive: true, force: true });
      totalBytes -= oldest.size;
    }
    sessionCount = sessions.length;
  } catch (err) {
    console.log("[LOG] Failed to rotate request logs:", err.message);
  }
}

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${y}${m}${d}_${h}${min}${s}_${ms}`;
}

async function createLogSession(sourceFormat, targetFormat, model) {
  await ensureNodeModules();
  if (!fs || !LOGS_DIR) return null;

  let sessionPath = null;
  try {
    const timestamp = formatTimestamp();
    const safeModel = (model || "unknown").replace(/[/:]/g, "-");
    const folderName = `${sourceFormat}_${targetFormat}_${safeModel}_${timestamp}`;
    sessionPath = path.join(LOGS_DIR, folderName);
    activeSessions.add(sessionPath);

    await fs.promises.mkdir(/* turbopackIgnore: true */ sessionPath, { recursive: true });
    sessionCount += 1;
    await pruneLogSessions(sessionCount > LOG_MAX_SESSIONS);

    return sessionPath;
  } catch (err) {
    console.log("[LOG] Failed to create log session:", err.message);
    return null;
  } finally {
    if (sessionPath) activeSessions.delete(sessionPath);
  }
}

const STREAM_IDLE_CLOSE_MS = 2000;

function createSessionWriter(sessionPath) {
  const streams = new Map();
  const pending = new Set();

  const closeEntry = (filename) => {
    const entry = streams.get(filename);
    if (!entry) return Promise.resolve();
    streams.delete(filename);
    clearTimeout(entry.timer);
    return new Promise((resolve) => {
      entry.stream.once("close", resolve);
      entry.stream.end();
    });
  };

  return {
    appendChunk(filename, chunk) {
      if (!fs || !sessionPath) return;
      let entry = streams.get(filename);
      if (!entry) {
        const stream = fs.createWriteStream(/* turbopackIgnore: true */ path.join(sessionPath, filename), { flags: "a" });
        stream.on("error", () => { streams.delete(filename); });
        entry = { stream, timer: null };
        streams.set(filename, entry);
      }
      entry.stream.write(chunk);
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => { closeEntry(filename); }, STREAM_IDLE_CLOSE_MS);
      entry.timer.unref?.();
    },
    writeJson(filename, data) {
      if (!fs || !sessionPath) return;
      let text;
      try { text = JSON.stringify(data, null, 2); } catch (err) {
        console.log(`[LOG] Failed to write ${filename}:`, err.message);
        return;
      }
      const p = fs.promises.writeFile(/* turbopackIgnore: true */ path.join(sessionPath, filename), text)
        .catch((err) => { console.log(`[LOG] Failed to write ${filename}:`, err.message); })
        .finally(() => pending.delete(p));
      pending.add(p);
    },
    async flush() {
      await Promise.all([...pending, ...[...streams.keys()].map(closeEntry)]);
    }
  };
}

function maskSensitiveHeaders(headers) {
  return redactClientHeaders(headers);
}

function createNoOpLogger() {
  return {
    sessionPath: null,
    logClientRawRequest() {},
    logRawRequest() {},
    logOpenAIRequest() {},
    logTargetRequest() {},
    logProviderResponse() {},
    appendProviderChunk() {},
    appendOpenAIChunk() {},
    logConvertedResponse() {},
    appendConvertedChunk() {},
    logError() {},
    async flush() {}
  };
}

export async function createRequestLogger(sourceFormat, targetFormat, model) {
  if (!LOGGING_ENABLED) {
    return createNoOpLogger();
  }
  
  const sessionPath = await createLogSession(sourceFormat, targetFormat, model);
  const writer = createSessionWriter(sessionPath);
  const writeJsonFile = (_sessionPath, filename, data) => writer.writeJson(filename, data);

  return {
    flush: () => writer.flush(),
    get sessionPath() { return sessionPath; },
    
    logClientRawRequest(endpoint, body, headers = {}) {
      writeJsonFile(sessionPath, "1_req_client.json", {
        timestamp: new Date().toISOString(),
        endpoint,
        headers: maskSensitiveHeaders(headers),
        body
      });
    },
    
    logRawRequest(body, headers = {}) {
      writeJsonFile(sessionPath, "2_req_source.json", {
        timestamp: new Date().toISOString(),
        headers: maskSensitiveHeaders(headers),
        body
      });
    },
    
    logOpenAIRequest(body) {
      writeJsonFile(sessionPath, "3_req_openai.json", {
        timestamp: new Date().toISOString(),
        body
      });
    },
    
    logTargetRequest(url, headers, body) {
      writeJsonFile(sessionPath, "4_req_target.json", {
        timestamp: new Date().toISOString(),
        url: redactUrlSecrets(url),
        headers: redactUpstreamHeaders(headers),
        body
      });
    },
    
    logProviderResponse(status, statusText, headers, body) {
      const filename = "5_res_provider.json";
      writeJsonFile(sessionPath, filename, {
        timestamp: new Date().toISOString(),
        status,
        statusText,
        headers: headers ? (typeof headers.entries === "function" ? Object.fromEntries(headers.entries()) : headers) : {},
        body
      });
    },
    
    appendProviderChunk(chunk) {
      writer.appendChunk("5_res_provider.txt", chunk);
    },
    
    appendOpenAIChunk(chunk) {
      writer.appendChunk("6_res_openai.txt", chunk);
    },
    
    logConvertedResponse(body) {
      writeJsonFile(sessionPath, "7_res_client.json", {
        timestamp: new Date().toISOString(),
        body
      });
    },
    
    appendConvertedChunk(chunk) {
      writer.appendChunk("7_res_client.txt", chunk);
    },
    
    logError(error, requestBody = null) {
      writeJsonFile(sessionPath, "6_error.json", {
        timestamp: new Date().toISOString(),
        error: error?.message || String(error),
        stack: error?.stack,
        requestBody
      });
    }
  };
}
