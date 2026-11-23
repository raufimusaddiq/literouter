import crypto from "node:crypto";

export const SERVER_ENV = {
  jwtSecret: "parity-jwt-secret-0123456789abcdef0123456789abcdef",
  apiKeySecret: "parity-api-key-secret",
  machineIdSalt: "parity-machine-salt",
  initialPassword: "parity-initial",
  machineId: "parity-machine-id-0001",
  cliSecret: "parity-cli-secret-0123456789abcdef0123456789abcdef",
  apiKey: "sk-parity-valid",
  tz: "Asia/Jakarta",
  cliAuthSalt: "9r-cli-auth",
};

export const cliToken = () =>
  crypto.createHash("sha256").update(SERVER_ENV.machineId + SERVER_ENV.cliAuthSalt + SERVER_ENV.cliSecret).digest("hex").substring(0, 16);
