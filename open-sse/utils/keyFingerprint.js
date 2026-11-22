import crypto from "crypto";

const FINGERPRINT_RE = /^fp_[0-9a-f]{16}$/;

let derived = { secret: null, key: null };
function fingerprintMacKey() {
  const secret = process.env.API_KEY_SECRET || "endpoint-proxy-api-key-secret";
  if (derived.secret !== secret) {
    derived = { secret, key: crypto.scryptSync(secret, "literouter-client-key-fingerprint", 32) };
  }
  return derived.key;
}

export const REDACTED = "[REDACTED]";

export function isKeyFingerprint(value) {
  return typeof value === "string" && FINGERPRINT_RE.test(value);
}

export function fingerprintKey(key) {
  if (!key || typeof key !== "string") return null;
  const trimmed = key.trim();
  if (!trimmed) return null;
  if (isKeyFingerprint(trimmed)) return trimmed;
  return "fp_" + crypto.createHmac("sha256", fingerprintMacKey()).update(trimmed).digest("hex").slice(0, 16);
}

const CLIENT_KEY_HEADERS = ["authorization", "x-api-key", "api-key"];
const SECRET_HEADER_PARTS = ["authorization", "api-key", "apikey", "cookie", "token", "secret", "credential"];

export function redactClientHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (CLIENT_KEY_HEADERS.includes(lower)) {
      const raw = typeof value === "string" ? value.replace(/^\s*bearer\s+/i, "") : value;
      out[name] = fingerprintKey(raw) || REDACTED;
    } else if (SECRET_HEADER_PARTS.some((p) => lower.includes(p))) {
      out[name] = REDACTED;
    } else {
      out[name] = value;
    }
  }
  return out;
}

export function redactUpstreamHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    out[name] = SECRET_HEADER_PARTS.some((p) => lower.includes(p)) ? REDACTED : value;
  }
  return out;
}
