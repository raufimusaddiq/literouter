const ISO = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g;
const CHATCMPL = /\bchatcmpl-[\w-]+/g;
const MSG = /\bmsg_[\w-]+/g;
const EPOCH_MS = /\b1[5-9]\d{11}\b/g;
const RESET_AFTER = /reset after \d+s/g;
const RETRY_TEXT = /\bin \d+s\b/g;

export const MASK = {
  iso: "<ISO>",
  epoch: "<EPOCH_MS>",
  uuid: "<UUID>",
  jwt: "<JWT>",
  chatcmpl: "chatcmpl-<ID>",
  msg: "msg_<ID>",
};

export function maskString(s) {
  return s
    .replace(JWT, MASK.jwt)
    .replace(ISO, MASK.iso)
    .replace(UUID, MASK.uuid)
    .replace(CHATCMPL, MASK.chatcmpl)
    .replace(MSG, MASK.msg)
    .replace(RESET_AFTER, "reset after <N>s")
    .replace(EPOCH_MS, MASK.epoch);
}

const TIMING_KEY = /^(latencyMs|durationMs|elapsedMs|ttftMs)$/;

export function normalizeBody(value) {
  if (typeof value === "string") return maskString(value);
  if (typeof value === "number") return value >= 1e12 && value < 2e12 ? MASK.epoch : value;
  if (Array.isArray(value)) return value.map(normalizeBody);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = typeof v === "number" && TIMING_KEY.test(k) ? "<MS>" : normalizeBody(v);
    return out;
  }
  return value;
}

export function maskRetryAfter(value) {
  if (typeof value === "string") return value.replace(RETRY_TEXT, "in <N>s");
  if (Array.isArray(value)) return value.map(maskRetryAfter);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = k === "retryAfter" && typeof v === "number" ? "<N>" : maskRetryAfter(v);
    return out;
  }
  return value;
}

const KEPT_HEADERS = new Set([
  "content-type",
  "content-encoding",
  "cache-control",
  "location",
  "retry-after",
  "allow",
  "www-authenticate",
  "x-accel-buffering",
]);

function maskExpires(value, now) {
  const at = Date.parse(value);
  if (Number.isNaN(at)) return "<DATE-INVALID>";
  return at <= now ? "<DATE-PAST>" : "<DATE-FUTURE>";
}

function maskSetCookie(raw, now) {
  const [pair, ...attrs] = raw.split(/;\s*/);
  const name = pair.split("=")[0];
  const kept = attrs.map((a) => {
    const [k, ...rest] = a.split("=");
    if (/^expires$/i.test(k)) return `${k}=${maskExpires(rest.join("="), now)}`;
    if (/^max-age$/i.test(k)) return a;
    return rest.length ? `${k}=${rest.join("=")}` : k;
  });
  return [`${name}=<MASKED>`, ...kept].join("; ");
}

export function normalizeHeaders(headers, now = Date.now()) {
  const entries = headers instanceof Headers ? [...headers] : Object.entries(headers);
  const out = {};
  const cookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  for (const [k, v] of entries) {
    const key = k.toLowerCase();
    if (key.startsWith("access-control-") || KEPT_HEADERS.has(key)) out[key] = String(v);
  }
  if (cookies.length) out["set-cookie"] = cookies.map((c) => maskSetCookie(c, now));
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function normalizeSse(text) {
  const frames = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    const frame = {};
    const data = [];
    const comments = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(":")) comments.push(line.slice(1).trim());
      else if (line.startsWith("event:")) frame.event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (comments.length) frame.comment = comments.join("\n");
    const joined = data.join("\n");
    frame.data = maskString(joined);
    if (!data.length) frame.data = "";
    frames.push(frame);
  }
  return frames;
}

export function summarizeBody(body) {
  const text = JSON.stringify(body);
  const shape = {};
  if (body && typeof body === "object") {
    for (const [k, v] of Object.entries(body)) shape[k] = Array.isArray(v) ? `array(${v.length})` : v && typeof v === "object" ? `object(${Object.keys(v).length})` : typeof v;
  }
  return { sha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"), bytes: text.length, shape };
}

export function shapeFrame(frame) {
  let shaped = null;
  try {
    const parsed = JSON.parse(frame.data);
    shaped = { type: parsed?.type ?? null, keys: Object.keys(parsed ?? {}).sort() };
  } catch {}
  return { ...(frame.event ? { event: frame.event } : {}), shape: shaped };
}
