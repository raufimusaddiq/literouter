import crypto from "crypto";

const API_KEY_SECRET = process.env.API_KEY_SECRET || "endpoint-proxy-api-key-secret";

/**
 * Legacy CRC (8-char HMAC), only used to recognise old-format keys
 */
function generateCrc(machineId, keyId) {
  return crypto
    .createHmac("sha256", API_KEY_SECRET)
    .update(machineId + keyId)
    .digest("hex")
    .slice(0, 8);
}

/**
 * Generate an unguessable API key: `sk-` + 24 random bytes (192 bits) base64url.
 * No machineId or other identifying material is embedded.
 * @param {string} [_machineId] - ignored; kept so existing callers keep working
 * @returns {{ key: string, keyId: string }}
 */
export function generateApiKeyWithMachine(_machineId) {
  const secret = crypto.randomBytes(24).toString("base64url");
  return { key: `sk-${secret}`, keyId: secret.slice(0, 6) };
}

/**
 * Parse API key and extract machineId + keyId
 * Supports:
 * - Current: sk-{32 base64url}
 * - Legacy: sk-{machineId}-{keyId}-{crc8}
 * - Legacy: sk-{random8}
 * @param {string} apiKey
 * @returns {{ machineId: string, keyId: string, isNewFormat: boolean } | null}
 */
export function parseApiKey(apiKey) {
  if (!apiKey || !apiKey.startsWith("sk-")) return null;

  // Current format: sk-{32 base64url chars} (192-bit random)
  if (/^sk-[A-Za-z0-9_-]{32}$/.test(apiKey)) {
    return { machineId: null, keyId: apiKey.slice(3, 9), isNewFormat: true, isLegacy: false };
  }

  const parts = apiKey.split("-");
  
  // New format: sk-{machineId}-{keyId}-{crc8} = 4 parts
  if (parts.length === 4) {
    const [, machineId, keyId, crc] = parts;
    
    // Validate CRC
    const expectedCrc = generateCrc(machineId, keyId);
    if (crc !== expectedCrc) return null;
    
    return { machineId, keyId, isNewFormat: true, isLegacy: true };
  }
  
  // Old format: sk-{random8} = 2 parts
  if (parts.length === 2) {
    return { machineId: null, keyId: parts[1], isNewFormat: false, isLegacy: true };
  }
  
  return null;
}

