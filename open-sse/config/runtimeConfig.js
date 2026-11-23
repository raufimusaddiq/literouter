export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_ACCEPTABLE: 406,
  REQUEST_TIMEOUT: 408,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
};

export { ERROR_TYPES, DEFAULT_ERROR_MESSAGES, BACKOFF_CONFIG, COOLDOWN_MS } from "./errorConfig.js";

export const CACHE_TTL = {
  userInfo: 300,
  modelAlias: 3600
};

export const MEMORY_CONFIG = {
  sessionTtlMs: 2 * 60 * 60 * 1000,
  sessionCleanupIntervalMs: 30 * 60 * 1000,
  dnsCacheTtlMs: 5 * 60 * 1000,
  proxyDispatchersMaxSize: (() => {
    const n = parseInt(process.env.PROXY_DISPATCHERS_MAX_SIZE || "", 10);
    return Number.isFinite(n) && n > 0 ? n : 256;
  })(),
};

function envMs(name, def) {
  const raw = process.env[name];
  if (raw == null || raw === "") return def;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

export const STREAM_STALL_TIMEOUT_MS = envMs("STREAM_STALL_TIMEOUT_MS", 360 * 1000);

export const STREAM_STALL_TIMEOUT_FLASH_MS = envMs("STREAM_STALL_TIMEOUT_FLASH_MS", 90 * 1000);

export const TRANSLATE_HEARTBEAT_MS = envMs("STREAM_HEARTBEAT_MS", 5 * 1000);

export const STREAM_FIRST_CHUNK_TIMEOUT_MS = envMs("STREAM_FIRST_CHUNK_TIMEOUT_MS", 200 * 1000);

export const PENDING_COMPLETION_FLUSH_MS = envMs("PENDING_COMPLETION_FLUSH_MS", 3000);

export const FETCH_CONNECT_TIMEOUT_MS = envMs("FETCH_CONNECT_TIMEOUT_MS", 60 * 1000);

export const REFRESH_TIMEOUT_MS = envMs("REFRESH_TIMEOUT_MS", 30 * 1000);

export const NON_STREAM_TOTAL_TIMEOUT_MS = envMs("NON_STREAM_TOTAL_TIMEOUT_MS", 10 * 60 * 1000);

export const UNDICI_BACKSTOP_MS = envMs(
  "UNDICI_BACKSTOP_MS",
  Math.max(NON_STREAM_TOTAL_TIMEOUT_MS, STREAM_STALL_TIMEOUT_MS, FETCH_CONNECT_TIMEOUT_MS) + 30 * 1000,
);

export const DEFAULT_KEEPALIVE_TIMEOUT_MS = 4 * 1000;
export const FRESH_RETRY_KEEPALIVE_TIMEOUT_MS = 1;
export const FETCH_KEEPALIVE_TIMEOUT_MS = envMs("FETCH_KEEPALIVE_TIMEOUT_MS", DEFAULT_KEEPALIVE_TIMEOUT_MS);

export function resolveKeepAliveTimeouts() {
  const timeout = envMs("FETCH_KEEPALIVE_TIMEOUT_MS", DEFAULT_KEEPALIVE_TIMEOUT_MS);
  return { keepAliveTimeout: timeout, keepAliveMaxTimeout: timeout };
}

export function isFreshSocketReplayEnabled() {
  const raw = String(process.env.FETCH_FRESH_RETRY ?? "").trim().toLowerCase();
  return !(raw === "off" || raw === "0" || raw === "false" || raw === "no");
}

export const STALE_SOCKET_ERROR_CODES = new Set([
  "UND_ERR_SOCKET",
  "ECONNRESET",
  "EPIPE",
]);

export const NON_STALE_SOCKET_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_INVALID_ARG",
]);

export const STALE_SOCKET_ERROR_SUBSTRINGS = [
  "other side closed",
  "socket hang up",
];

export const MODEL_TEST_TIMEOUT_MS = envMs("MODEL_TEST_TIMEOUT_MS", 200 * 1000);

export const GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS = envMs("GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS", 45 * 1000);

export const DEFAULT_MAX_TOKENS = 64000;
export const DEFAULT_MIN_TOKENS = 32000;

export const TOKEN_SAVER_HEADER = "x-9router-token-saver";
export const TOKEN_SAVER_HEADER_ALIASES = [TOKEN_SAVER_HEADER, "x-literouter-token-saver"];
export const isTokenSaverEnabled = (headers = {}) => !TOKEN_SAVER_HEADER_ALIASES.some(
  (header) => headers[header]?.toLowerCase() === "off",
);

export const RETRY_CONFIG = {
  maxAttempts: 2,
  delayMs: 2000
};

export const DEFAULT_RETRY_CONFIG = {
  408: { attempts: 1, delayMs: 300 },
  429: { attempts: 0, delayMs: 0 },
  502: { attempts: 3, delayMs: 3000 },
  503: { attempts: 3, delayMs: 2000 }
};

export function resolveRetryEntry(entry) {
  if (entry == null) return { attempts: 0, delayMs: RETRY_CONFIG.delayMs };
  if (typeof entry === "number") return { attempts: entry, delayMs: RETRY_CONFIG.delayMs };
  return {
    attempts: entry.attempts || 0,
    delayMs: entry.delayMs != null ? entry.delayMs : RETRY_CONFIG.delayMs
  };
}

export const SKIP_PATTERNS = [
  "Please write a 5-10 word title for the following conversation:"
];

export const MAX_COMBO_DEPTH = 8;
