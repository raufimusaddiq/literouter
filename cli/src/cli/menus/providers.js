const api = require("../api/client");
const { prompt, confirm, pause } = require("../utils/input");
const { clearScreen, showStatus, showHeader } = require("../utils/display");
const { showMenuWithBack } = require("../utils/menuHelper");
const { copyToClipboard } = require("../utils/clipboard");

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m"
};

const OAUTH_PROVIDERS = {
  claude: { id: "claude", alias: "cc", name: "Claude Code" },
  codex: { id: "codex", alias: "cx", name: "OpenAI Codex" },
  "gemini-cli": { id: "gemini-cli", alias: "gc", name: "Gemini CLI" },
  github: { id: "github", alias: "gh", name: "GitHub Copilot" },
  antigravity: { id: "antigravity", alias: "ag", name: "Antigravity" },
  iflow: { id: "iflow", alias: "if", name: "iFlow AI" },
  qwen: { id: "qwen", alias: "qw", name: "Qwen Code" },
  kiro: { id: "kiro", alias: "kr", name: "Kiro AI" },
};

const APIKEY_PROVIDERS = {
  openrouter: { id: "openrouter", name: "OpenRouter" },
  glm: { id: "glm", name: "GLM Coding" },
  minimax: { id: "minimax", name: "Minimax Coding" },
  kimi: { id: "kimi", name: "Kimi" },
  openai: { id: "openai", name: "OpenAI" },
  anthropic: { id: "anthropic", name: "Anthropic" },
  gemini: { id: "gemini", name: "Gemini" },
};

const ALL_PROVIDERS = { ...OAUTH_PROVIDERS, ...APIKEY_PROVIDERS };

function countConnectionsByProvider(connections) {
  const counts = {};
  connections.forEach(conn => {
    const providerId = conn.provider || conn.providerId;
    counts[providerId] = (counts[providerId] || 0) + 1;
  });
  return counts;
}

async function showProvidersMenu(breadcrumb = []) {
  const providerItems = [];
  
  Object.values(OAUTH_PROVIDERS).forEach(provider => {
    providerItems.push({
      provider,
      authType: "oauth",
      label: (data) => {
        const count = data.counts[provider.id] || 0;
        return `${provider.name} (OAuth) - ${count} Connected`;
      },
      action: async (data) => {
        await showProviderDetail(provider.id, "oauth", data.connections, [...breadcrumb, provider.name]);
        return true;
      }
    });
  });
  
  Object.values(APIKEY_PROVIDERS).forEach(provider => {
    providerItems.push({
      provider,
      authType: "apikey",
      label: (data) => {
        const count = data.counts[provider.id] || 0;
        return `${provider.name} (API) - ${count} Connected`;
      },
      action: async (data) => {
        await showProviderDetail(provider.id, "apikey", data.connections, [...breadcrumb, provider.name]);
        return true;
      }
    });
  });

  providerItems.push({
    label: () => `${COLORS.dim}── Custom Providers ──${COLORS.reset}`,
    action: async () => true,
    isSeparator: true,
  });
  providerItems.push({
    label: (data) => {
      const count = data.nodeCount || 0;
      return `Custom Providers - ${count} Configured`;
    },
    action: async () => {
      await showCustomProvidersMenu([...breadcrumb, "Custom Providers"]);
      return true;
    }
  });

  await showMenuWithBack({
    title: "🔌 Providers Management",
    breadcrumb,
    refresh: async () => {
      const [provRes, nodeRes] = await Promise.all([api.getProviders(), api.getProviderNodes()]);
      if (!provRes.success) {
        showStatus(`Failed to fetch providers: ${provRes.error}`, "error");
        await pause();
        return null;
      }
      const connections = provRes.data.connections || [];
      const nodes = nodeRes.success ? (nodeRes.data.nodes || nodeRes.data || []) : [];
      return {
        connections,
        counts: countConnectionsByProvider(connections),
        nodeCount: nodes.length,
      };
    },
    items: providerItems
  });
}

const MODELS_TIMEOUT_MS = 3000;
const MODELS_OFFLINE = "Unavailable (server not running)";

function groupModelsByAlias(models) {
  const byAlias = {};
  for (const model of models || []) {
    const [alias] = (model.routedModel || model.fullModel || "").split("/");
    const id = model.model || model.id;
    if (!alias || !id) continue;
    (byAlias[alias] ||= []).push(id);
  }
  return byAlias;
}

async function fetchModelsByAlias() {
  const res = await api.getModels({ timeout: MODELS_TIMEOUT_MS });
  if (!res.success) return null;
  return groupModelsByAlias(res.data.models);
}

function buildProviderHeader(providerId, modelsByAlias) {
  const provider = ALL_PROVIDERS[providerId];
  const alias = provider.alias || providerId;

  const lines = [];
  lines.push(`Alias: ${COLORS.cyan}${alias}${COLORS.reset}`);

  if (!modelsByAlias) {
    lines.push(`Models: ${COLORS.dim}${MODELS_OFFLINE}${COLORS.reset}`);
    return lines.join("\n");
  }

  const models = modelsByAlias[alias] || [];
  if (models.length > 0) {
    const modelList = models
      .slice(0, 5)
      .map(m => `${alias}/${m}`)
      .join(", ");
    const more = models.length > 5 ? ` (+${models.length - 5} more)` : "";
    lines.push(`Models: ${COLORS.dim}${modelList}${more}${COLORS.reset}`);
  } else {
    lines.push(`Models: ${COLORS.dim}No models configured${COLORS.reset}`);
  }
  
  return lines.join("\n");
}

async function showProviderDetail(providerId, authType, allConnections, breadcrumb = []) {
  const provider = ALL_PROVIDERS[providerId];
  const { showListMenu } = require("../utils/menuHelper");
  const modelsByAlias = await fetchModelsByAlias();

  await showListMenu({
    title: `🔌 ${provider.name} (${authType.toUpperCase()})`,
    breadcrumb,
    backLabel: "← Back to Providers",
    headerContent: buildProviderHeader(providerId, modelsByAlias),
    fetchItems: async () => {
      const response = await api.getProviders();
      if (response.success) {
        allConnections.length = 0;
        allConnections.push(...(response.data.connections || []));
      }
      const providerConns = allConnections.filter(conn => 
        (conn.provider || conn.providerId) === providerId
      );
      return { items: providerConns };
    },
    formatItem: (conn) => {
      const status = conn.testStatus === "active" ? "✓" : conn.testStatus === "error" ? "✗" : "?";
      const name = conn.name || conn.email || conn.displayName || "Unnamed";
      return `${name} (${status})`;
    },
    onSelect: async (conn) => {
      await showConnectionActions(conn, providerId, breadcrumb);
    },
    createAction: {
      label: "Add New Connection",
      action: async () => {
        await handleAddConnection(providerId, authType);
      }
    }
  });
}

async function showConnectionActions(connection, providerId, breadcrumb = []) {
  const name = connection.name || connection.email || connection.displayName || "Unnamed";
  const status = connection.testStatus === "active" ? "✓ Active" : 
                 connection.testStatus === "error" ? "✗ Error" : "? Unknown";
  
  await showMenuWithBack({
    title: `🔌 ${name}`,
    breadcrumb: [...breadcrumb, name],
    headerContent: `Connection: ${name}\nStatus: ${status}`,
    items: [
      {
        label: "Rename Connection",
        action: async () => {
          const newName = await prompt(`New name (current: ${name}): `);
          if (newName && newName.trim()) {
            showStatus("Renaming connection...", "info");
            const result = await api.updateConnection(connection.id, { name: newName.trim() });
            if (result.success) {
              showStatus("Connection renamed!", "success");
              connection.name = newName.trim();
            } else {
              showStatus(`Rename failed: ${result.error}`, "error");
            }
            await pause();
          }
          return true;
        }
      },
      {
        label: "Test Connection",
        action: async () => {
          showStatus("Testing connection...", "info");
          const result = await api.testConnection(connection.id);
          if (result.success) {
            showStatus("Connection is working!", "success");
          } else {
            showStatus(`Test failed: ${result.error}`, "error");
          }
          await pause();
          return true;
        }
      },
      {
        label: "Delete Connection",
        action: async () => {
          const confirmed = await confirm(`Delete connection "${name}"?`);
          if (confirmed) {
            const result = await api.deleteConnection(connection.id);
            if (result.success) {
              showStatus("Connection deleted!", "success");
            } else {
              showStatus(`Delete failed: ${result.error}`, "error");
            }
            await pause();
            return false;
          }
          return true;
        }
      }
    ]
  });
}

const DEVICE_CODE_PROVIDERS = ["github", "qwen", "kiro"];

async function handleAddConnection(providerId, authType) {
  if (authType === "apikey") {
    await handleAddApiKeyConnection(providerId);
  } else {
    if (DEVICE_CODE_PROVIDERS.includes(providerId)) {
      await handleAddDeviceCodeConnection(providerId);
    } else {
      await handleAddOAuthConnection(providerId);
    }
  }
}

async function handleAddApiKeyConnection(providerId) {
  clearScreen();
  const provider = ALL_PROVIDERS[providerId];
  console.log(`\n➕ Add ${provider.name} API Key Connection\n`);
  
  const name = await prompt("Connection Name: ");
  if (!name) {
    showStatus("Cancelled", "warning");
    await pause();
    return;
  }
  
  const apiKey = await prompt("API Key: ");
  if (!apiKey) {
    showStatus("Cancelled", "warning");
    await pause();
    return;
  }
  
  showStatus("Creating connection...", "info");
  
  const result = await api.createApiKeyProvider({
    provider: providerId,
    name,
    apiKey
  });
  
  if (result.success) {
    showStatus("✓ Connection created successfully!", "success");
  } else {
    showStatus(`✗ Failed: ${result.error}`, "error");
  }
  
  await pause();
}

async function handleAddOAuthConnection(providerId) {
  clearScreen();
  const provider = ALL_PROVIDERS[providerId];
  
  showStatus("Requesting authorization URL...", "info");
  const authResult = await api.getOAuthAuthUrl(providerId);
  
  if (!authResult.success) {
    showStatus(`Failed: ${authResult.error}`, "error");
    await pause();
    return;
  }
  
  const authData = authResult.data || authResult;
  const authUrl = authData.authUrl;
  const codeVerifier = authData.codeVerifier;
  const state = authData.state;
  const redirectUri = authData.redirectUri;
  
  if (!authUrl) {
    showStatus("Failed: No auth URL received", "error");
    await pause();
    return;
  }
  
  clearScreen();
  showHeader("🔐 OAuth Login", `Providers > ${provider.name} > Add Connection`);
  
  console.log(`  ${COLORS.bold}${COLORS.cyan}1.${COLORS.reset} Open this URL in your browser:`);
  console.log(`     ${COLORS.dim}${authUrl}${COLORS.reset}`);
  if (copyToClipboard(authUrl)) {
    console.log(`     \x1b[32m✓ Link copied to clipboard!\x1b[0m`);
  }
  console.log();
  console.log(`  ${COLORS.bold}${COLORS.cyan}2.${COLORS.reset} Complete authorization in browser`);
  console.log();
  console.log(`  ${COLORS.bold}${COLORS.cyan}3.${COLORS.reset} Copy the callback URL from address bar`);
  console.log(`     ${COLORS.dim}(looks like: http://localhost:20128/callback?code=...)${COLORS.reset}`);
  console.log();
  
  const callbackUrl = await prompt("  Paste callback URL: ");
  if (!callbackUrl) {
    showStatus("Cancelled", "warning");
    await pause();
    return;
  }
  
  let code, urlState, error;
  try {
    const url = new URL(callbackUrl.trim());
    code = url.searchParams.get("code");
    urlState = url.searchParams.get("state");
    error = url.searchParams.get("error");
    
    if (error) {
      const errorDesc = url.searchParams.get("error_description") || error;
      showStatus(`Authorization failed: ${errorDesc}`, "error");
      await pause();
      return;
    }
    
    if (!code) {
      showStatus("No authorization code found in URL", "error");
      await pause();
      return;
    }
  } catch (err) {
    showStatus("Invalid URL format", "error");
    await pause();
    return;
  }
  
  console.log();
  showStatus("Exchanging code for tokens...", "info");
  const exchangeResult = await api.exchangeOAuthCode(providerId, {
    code,
    redirectUri,
    codeVerifier,
    state: urlState || state
  });
  
  if (exchangeResult.success) {
    showStatus("Connection created successfully!", "success");
  } else {
    showStatus(`Failed: ${exchangeResult.error}`, "error");
  }
  
  await pause();
}

async function handleAddDeviceCodeConnection(providerId) {
  clearScreen();
  const provider = ALL_PROVIDERS[providerId];
  
  showStatus("Requesting device code...", "info");
  const deviceResult = await api.getOAuthDeviceCode(providerId);
  
  if (!deviceResult.success) {
    showStatus(`Failed: ${deviceResult.error}`, "error");
    await pause();
    return;
  }
  
  const deviceData = deviceResult.data || deviceResult;
  const device_code = deviceData.device_code;
  const user_code = deviceData.user_code;
  const verification_uri = deviceData.verification_uri;
  const verification_uri_complete = deviceData.verification_uri_complete;
  const codeVerifier = deviceData.codeVerifier;
  const extraData = deviceData.extraData || deviceData;
  
  if (!device_code) {
    showStatus("Failed: No device code received", "error");
    await pause();
    return;
  }
  
  clearScreen();
  const deviceUrl = verification_uri_complete || verification_uri;
  showHeader("📱 Device Login", `Providers > ${provider.name} > Add Connection`);
  
  console.log(`  ${COLORS.bold}${COLORS.cyan}1.${COLORS.reset} Open: ${COLORS.dim}${deviceUrl}${COLORS.reset}`);
  if (copyToClipboard(deviceUrl)) {
    console.log(`     \x1b[32m✓ Link copied to clipboard!\x1b[0m`);
  }
  console.log();
  if (!verification_uri_complete && user_code) {
    console.log(`  ${COLORS.bold}${COLORS.cyan}2.${COLORS.reset} Enter code: ${COLORS.bold}${user_code}${COLORS.reset}`);
    console.log();
  }
  console.log(`  ${COLORS.dim}Waiting for authorization...${COLORS.reset}`);
  console.log();
  
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const pollResult = await api.pollOAuthToken(providerId, {
      deviceCode: device_code,
      codeVerifier,
      extraData
    });
    
    if (pollResult.success) {
      showStatus("\nConnection created successfully!", "success");
      await pause();
      return;
    }
    
    const isPending = pollResult.pending || pollResult.error === "authorization_pending" || pollResult.error === "slow_down";
    if (!isPending) {
      showStatus(`\nFailed: ${pollResult.error || "Unknown error"}`, "error");
      await pause();
      return;
    }
    
    process.stdout.write(".");
  }
  
  showStatus("\nTimeout waiting for authorization", "error");
  await pause();
}


const CUSTOM_NODE_TYPES = ["openai-compatible", "anthropic-compatible"];
const OPENAI_API_TYPES = ["chat", "responses"];

async function showCustomProvidersMenu(breadcrumb = []) {
  const { showListMenu } = require("../utils/menuHelper");

  await showListMenu({
    title: "🔧 Custom Providers",
    breadcrumb,
    backLabel: "← Back to Providers",
    fetchItems: async () => {
      const res = await api.getProviderNodes();
      if (!res.success) return { items: [] };
      return { items: res.data.nodes || res.data || [] };
    },
    formatItem: (providerNode) => `[${providerNode.prefix}] ${providerNode.name} (${providerNode.type})`,
    onSelect: async (providerNode) => {
      await showCustomNodeDetail(providerNode, [...breadcrumb, providerNode.name]);
    },
    createAction: {
      label: "➕ Add Custom Provider",
      action: async () => {
        await handleAddCustomNode();
      }
    }
  });
}

async function showCustomNodeDetail(providerNode, breadcrumb = []) {
  await showMenuWithBack({
    title: `🔧 ${providerNode.name}`,
    breadcrumb,
    headerContent: [
      `Type: ${providerNode.type}`,
      `Prefix: ${COLORS.cyan}${providerNode.prefix}${COLORS.reset}`,
      `Base URL: ${COLORS.dim}${providerNode.baseUrl}${COLORS.reset}`,
    ].join("\n"),
    items: [
      {
        label: "Connections",
        action: async () => {
          await showCustomNodeConnections(providerNode, breadcrumb);
          return true;
        }
      },
      {
        label: "Edit Node",
        action: async () => {
          await handleEditCustomNode(providerNode);
          return true;
        }
      },
      {
        label: "Delete Node",
        action: async () => {
          const confirmed = await confirm(`Delete "${providerNode.name}" and all its connections?`);
          if (confirmed) {
            const res = await api.deleteProviderNode(providerNode.id);
            if (res.success) {
              showStatus("Node deleted!", "success");
            } else {
              showStatus(`Delete failed: ${res.error}`, "error");
            }
            await pause();
            return false;
          }
          return true;
        }
      }
    ]
  });
}

async function showCustomNodeConnections(providerNode, breadcrumb = []) {
  const { showListMenu } = require("../utils/menuHelper");

  await showListMenu({
    title: `🔌 ${providerNode.name} – Connections`,
    breadcrumb,
    backLabel: "← Back",
    fetchItems: async () => {
      const res = await api.getProviders();
      if (!res.success) return { items: [] };
      const all = res.data.connections || [];
      const items = all.filter(c => c.provider === providerNode.id);
      return { items };
    },
    formatItem: (conn) => {
      const status = conn.testStatus === "active" ? "✓" : conn.testStatus === "error" ? "✗" : "?";
      return `${conn.name || "Unnamed"} (${status})`;
    },
    onSelect: async (conn) => {
      await showConnectionActions(conn, providerNode.id, breadcrumb);
    },
    createAction: {
      label: "Add API Key Connection",
      action: async () => {
        await handleAddCustomNodeConnection(providerNode);
      }
    }
  });
}

async function handleAddCustomNodeConnection(providerNode) {
  clearScreen();
  console.log(`\n➕ Add Connection to ${providerNode.name}\n`);

  const name = await prompt("Connection Name: ");
  if (!name) { showStatus("Cancelled", "warning"); await pause(); return; }

  const apiKey = await prompt("API Key: ");
  if (!apiKey) { showStatus("Cancelled", "warning"); await pause(); return; }

  showStatus("Creating connection...", "info");
  const res = await api.createApiKeyProvider({ provider: providerNode.id, name, apiKey });

  showStatus(res.success ? "✓ Connection created!" : `✗ Failed: ${res.error}`, res.success ? "success" : "error");
  await pause();
}

async function handleAddCustomNode() {
  clearScreen();
  console.log("\n➕ Add Custom Provider\n");

  const typeChoices = CUSTOM_NODE_TYPES.map((t, i) => `  ${i + 1}. ${t}`).join("\n");
  console.log(`Select type:\n${typeChoices}\n`);
  const typeInput = await prompt("Type (1/2): ");
  const typeIdx = parseInt(typeInput) - 1;
  if (isNaN(typeIdx) || !CUSTOM_NODE_TYPES[typeIdx]) {
    showStatus("Cancelled", "warning"); await pause(); return;
  }
  const type = CUSTOM_NODE_TYPES[typeIdx];

  const name = await prompt("Name: ");
  if (!name) { showStatus("Cancelled", "warning"); await pause(); return; }

  const prefix = await prompt("Prefix (used in model IDs, e.g. myapi): ");
  if (!prefix) { showStatus("Cancelled", "warning"); await pause(); return; }

  const baseUrl = await prompt("Base URL (e.g. https://api.example.com/v1): ");
  if (!baseUrl) { showStatus("Cancelled", "warning"); await pause(); return; }

  let apiType;
  if (type === "openai-compatible") {
    const apiTypeChoices = OPENAI_API_TYPES.map((t, i) => `  ${i + 1}. ${t}`).join("\n");
    console.log(`\nAPI Type:\n${apiTypeChoices}\n`);
    const apiTypeInput = await prompt("API Type (1/2, default 1): ");
    const apiTypeIdx = parseInt(apiTypeInput) - 1;
    apiType = OPENAI_API_TYPES[apiTypeIdx] || "chat";
  }

  showStatus("Creating provider node...", "info");
  const body = { name, prefix, baseUrl, type, ...(apiType && { apiType }) };
  const res = await api.createProviderNode(body);

  showStatus(res.success ? "✓ Provider created!" : `✗ Failed: ${res.error}`, res.success ? "success" : "error");
  await pause();
}

async function handleEditCustomNode(providerNode) {
  clearScreen();
  console.log(`\n✏️  Edit ${providerNode.name}\n`);
  console.log(`${COLORS.dim}Leave blank to keep current value${COLORS.reset}\n`);

  const name = await prompt(`Name (${providerNode.name}): `);
  const baseUrl = await prompt(`Base URL (${providerNode.baseUrl}): `);
  const prefix = await prompt(`Prefix (${providerNode.prefix}): `);

  const updates = {};
  if (name && name.trim()) updates.name = name.trim();
  if (baseUrl && baseUrl.trim()) updates.baseUrl = baseUrl.trim();
  if (prefix && prefix.trim()) updates.prefix = prefix.trim();

  if (!Object.keys(updates).length) {
    showStatus("No changes", "warning"); await pause(); return;
  }

  showStatus("Updating...", "info");
  const res = await api.updateProviderNode(providerNode.id, updates);
  if (res.success) {
    Object.assign(providerNode, updates);
    showStatus("✓ Updated!", "success");
  } else {
    showStatus(`✗ Failed: ${res.error}`, "error");
  }
  await pause();
}

module.exports = { showProvidersMenu, buildProviderHeader, groupModelsByAlias, fetchModelsByAlias };
