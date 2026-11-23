const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("node:fs");
const path = require("node:path");
const { machineIdSync } = require("node-machine-id");

const DEFAULT_CONFIG = {
  host: "127.0.0.1",
  port: 20128,
  protocol: "http:",
};

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";
const { getDataDir } = require("../../../hooks/dataDir");

const MACHINE_ID_FILE = path.join(getDataDir(), "machine-id");
const AUTH_DIR = path.join(getDataDir(), "auth");
const CLI_SECRET_FILE = path.join(AUTH_DIR, "cli-secret");

let config = { ...DEFAULT_CONFIG };
let cachedCliToken = null;
let cachedCliSecret = null;

function loadRawMachineId() {
  try {
    const raw = fs.readFileSync(MACHINE_ID_FILE, "utf8").trim();
    if (raw) return raw;
  } catch {}
  try { return machineIdSync(); } catch { return ""; }
}

function loadCliSecret() {
  if (cachedCliSecret) return cachedCliSecret;
  try {
    cachedCliSecret = fs.readFileSync(CLI_SECRET_FILE, "utf8").trim();
    if (cachedCliSecret) return cachedCliSecret;
  } catch {}
  cachedCliSecret = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    fs.writeFileSync(CLI_SECRET_FILE, cachedCliSecret, { mode: 0o600 });
  } catch {}
  return cachedCliSecret;
}

function getCliToken() {
  if (cachedCliToken !== null) return cachedCliToken;
  const raw = loadRawMachineId();
  const secret = loadCliSecret();
  cachedCliToken = raw ? crypto.createHash("sha256").update(raw + CLI_TOKEN_SALT + secret).digest("hex").substring(0, 16) : "";
  return cachedCliToken;
}

function configure(options = {}) {
  config = { ...config, ...options };
}

function makeRequest(method, path, body = null) {
  return new Promise((resolve) => {
    const httpModule = config.protocol === "https:" ? https : http;
    
    const options = {
      hostname: config.host,
      port: config.port,
      path: path,
      method: method,
      headers: {
        "Content-Type": "application/json",
        [CLI_TOKEN_HEADER]: getCliToken(),
      },
    };

    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      const bodyString = JSON.stringify(body);
      options.headers["Content-Length"] = Buffer.byteLength(bodyString);
    }

    const req = httpModule.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          
          if (res.statusCode >= 400 || parsed.error) {
            resolve({
              success: false,
              error: parsed.error || `HTTP ${res.statusCode}`,
              statusCode: res.statusCode,
            });
          } else {
            resolve({
              success: true,
              data: parsed,
              statusCode: res.statusCode,
            });
          }
        } catch (err) {
          resolve({
            success: false,
            error: `Failed to parse response: ${err.message}`,
          });
        }
      });
    });

    req.on("error", (err) => {
      resolve({
        success: false,
        error: `Network error: ${err.message}`,
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        success: false,
        error: "Request timeout",
      });
    });

    req.setTimeout(30000);

    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}


async function getProviders() {
  return makeRequest("GET", "/api/providers");
}

async function getProviderById(id) {
  return makeRequest("GET", `/api/providers/${id}`);
}

async function testProvider(id) {
  return makeRequest("POST", `/api/providers/${id}/test`);
}

async function deleteProvider(id) {
  return makeRequest("DELETE", `/api/providers/${id}`);
}

async function getProviderModels(id) {
  return makeRequest("GET", `/api/providers/${id}/models`);
}


async function getOAuthAuthUrl(provider) {
  const redirectUri = provider === "codex" 
    ? "http://localhost:1455/auth/callback"
    : "http://localhost:20128/callback";
  return makeRequest("GET", `/api/oauth/${provider}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`);
}

async function exchangeOAuthCode(provider, data) {
  return makeRequest("POST", `/api/oauth/${provider}/exchange`, data);
}

async function getOAuthDeviceCode(provider) {
  return makeRequest("GET", `/api/oauth/${provider}/device-code`);
}

async function pollOAuthToken(provider, data) {
  return makeRequest("POST", `/api/oauth/${provider}/poll`, data);
}

async function createApiKeyProvider(data) {
  return makeRequest("POST", "/api/providers", data);
}

async function updateConnection(id, data) {
  return makeRequest("PUT", `/api/providers/${id}`, data);
}


async function getApiKeys() {
  return makeRequest("GET", "/api/keys");
}

async function createApiKey(name) {
  return makeRequest("POST", "/api/keys", { name });
}

async function deleteApiKey(id) {
  return makeRequest("DELETE", `/api/keys/${id}`);
}


async function getCombos() {
  return makeRequest("GET", "/api/combos");
}

async function getComboById(id) {
  return makeRequest("GET", `/api/combos/${id}`);
}

async function createCombo(data) {
  return makeRequest("POST", "/api/combos", data);
}

async function updateCombo(id, data) {
  return makeRequest("PUT", `/api/combos/${id}`, data);
}

async function deleteCombo(id) {
  return makeRequest("DELETE", `/api/combos/${id}`);
}


async function getSettings() {
  return makeRequest("GET", "/api/settings");
}

async function updateSettings(data) {
  return makeRequest("PATCH", "/api/settings", data);
}

async function resetPassword() {
  return makeRequest("POST", "/api/auth/reset-password");
}


async function getModels() {
  return makeRequest("GET", "/api/models");
}

async function getAvailableModels() {
  return makeRequest("GET", "/v1/models");
}


async function getProviderNodes() {
  return makeRequest("GET", "/api/provider-nodes");
}

async function createProviderNode(data) {
  return makeRequest("POST", "/api/provider-nodes", data);
}

async function updateProviderNode(id, data) {
  return makeRequest("PUT", `/api/provider-nodes/${id}`, data);
}

async function deleteProviderNode(id) {
  return makeRequest("DELETE", `/api/provider-nodes/${id}`);
}

async function validateProviderNode(data) {
  return makeRequest("POST", "/api/provider-nodes/validate", data);
}


module.exports = {
  configure,
  
  getProviders,
  getProviderById,
  testProvider,
  deleteProvider,
  getProviderModels,
  
  testConnection: testProvider,
  deleteConnection: deleteProvider,
  updateConnection,
  
  getOAuthAuthUrl,
  exchangeOAuthCode,
  getOAuthDeviceCode,
  pollOAuthToken,
  createApiKeyProvider,
  
  getApiKeys,
  createApiKey,
  deleteApiKey,
  
  getCombos,
  getComboById,
  createCombo,
  updateCombo,
  deleteCombo,
  

  getSettings,
  updateSettings,
  resetPassword,
  
  getModels,
  getAvailableModels,

  getProviderNodes,
  createProviderNode,
  updateProviderNode,
  deleteProviderNode,
  validateProviderNode,
};
