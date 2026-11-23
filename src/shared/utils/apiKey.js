import crypto from "crypto";

const API_KEY_SECRET = process.env.API_KEY_SECRET || "endpoint-proxy-api-key-secret";

function generateCrc(machineId, keyId) {
  return crypto
    .createHmac("sha256", API_KEY_SECRET)
    .update(machineId + keyId)
    .digest("hex")
    .slice(0, 8);
}

export function generateApiKeyWithMachine(_machineId) {
  const secret = crypto.randomBytes(24).toString("base64url");
  return { key: `sk-${secret}`, keyId: secret.slice(0, 6) };
}

export function parseApiKey(apiKey) {
  if (!apiKey || !apiKey.startsWith("sk-")) return null;

  if (/^sk-[A-Za-z0-9_-]{32}$/.test(apiKey)) {
    return { machineId: null, keyId: apiKey.slice(3, 9), isNewFormat: true, isLegacy: false };
  }

  const parts = apiKey.split("-");
  
  if (parts.length === 4) {
    const [, machineId, keyId, crc] = parts;
    
    const expectedCrc = generateCrc(machineId, keyId);
    if (crc !== expectedCrc) return null;
    
    return { machineId, keyId, isNewFormat: true, isLegacy: true };
  }
  
  if (parts.length === 2) {
    return { machineId: null, keyId: parts[1], isNewFormat: false, isLegacy: true };
  }
  
  return null;
}

