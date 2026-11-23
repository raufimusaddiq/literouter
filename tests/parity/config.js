import crypto from "node:crypto";
import os from "node:os";

export const PARITY = {
  jwtSecret: "parity-jwt-secret-0123456789abcdef0123456789abcdef",
  apiKeySecret: "parity-api-key-secret",
  machineIdSalt: "parity-machine-salt",
  initialPassword: "parity-initial",
  machineId: "parity-machine-id-0001",
  cliSecret: "parity-cli-secret-0123456789abcdef0123456789abcdef",
  password: "parity-pass",
  apiKey: "sk-parity-valid",
  tz: "Asia/Jakarta",
  mockPort: 29877,
  slowStreamPauseMs: 4000,
  cliAuthSalt: "9r-cli-auth",
  proxiedIp: "203.0.113.9",
};

export const cliToken = () =>
  crypto.createHash("sha256").update(PARITY.machineId + PARITY.cliAuthSalt + PARITY.cliSecret).digest("hex").substring(0, 16);

export function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return null;
}
