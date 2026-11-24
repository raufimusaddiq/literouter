const api = require("../api/client");
const { prompt, confirm, pause } = require("../utils/input");
const { clearScreen, showStatus, showHeader } = require("../utils/display");
const { maskKey, formatDate, getRelativeTime } = require("../utils/format");
const { showMenuWithBack } = require("../utils/menuHelper");
const { copyToClipboard } = require("../utils/clipboard");
const { getEndpoint } = require("../utils/endpoint");

async function handleCreateKey() {
  console.log("\n📝 Create New API Key");
  console.log("─".repeat(30));
  
  const name = await prompt("Enter key name: ");
  
  if (!name) {
    showStatus("Key name cannot be empty", "error");
    await pause();
    return false;
  }
  
  const result = await api.createApiKey(name);
  
  if (!result.success) {
    showStatus(`Failed to create key: ${result.error}`, "error");
    await pause();
    return false;
  }
  
  console.log("\n✅ API Key created successfully!");
  console.log("\n⚠️  IMPORTANT: Save this key now. You won't be able to see it again!");
  console.log(`\nKey: ${result.data.key}`);
  console.log(`Name: ${result.data.name}`);
  console.log(`ID: ${result.data.id}`);
  
  const shouldCopy = await confirm("\nCopy key to clipboard?");
  if (shouldCopy) {
    if (copyToClipboard(result.data.key)) {
      showStatus("Key copied to clipboard!", "success");
    } else {
      showStatus("Failed to copy to clipboard", "error");
    }
  }
  
  await pause();
  return true;
}

async function handleViewFullKey(key) {
  console.log("\n🔍 Full API Key");
  console.log("─".repeat(30));
  console.log(`Name: ${key.name}`);
  console.log(`Key: ${key.key}`);
  console.log(`ID: ${key.id}`);
  console.log(`Created: ${formatDate(key.createdAt)}`);
  
  if (key.lastUsedAt) {
    console.log(`Last used: ${getRelativeTime(key.lastUsedAt)}`);
  } else {
    console.log("Last used: Never");
  }
  
  await pause();
}

async function handleCopyKey(key) {
  if (copyToClipboard(key.key)) {
    showStatus(`Key "${key.name}" copied to clipboard!`, "success");
  } else {
    showStatus("Failed to copy to clipboard", "error");
  }
  await pause();
}

async function handleDeleteKey(key) {
  console.log(`\n⚠️  Delete API Key: ${key.name}`);
  console.log("─".repeat(30));
  console.log(`Key: ${maskKey(key.key)}`);
  console.log(`Created: ${formatDate(key.createdAt)}`);
  
  const confirmed = await confirm("\nAre you sure you want to delete this key?");
  
  if (!confirmed) {
    showStatus("Deletion cancelled", "info");
    await pause();
    return false;
  }
  
  const result = await api.deleteApiKey(key.id);
  
  if (!result.success) {
    showStatus(`Failed to delete key: ${result.error}`, "error");
    await pause();
    return false;
  }
  
  showStatus("API key deleted successfully", "success");
  await pause();
  return true;
}

async function showKeyActions(key, port, breadcrumb = []) {
  const { endpoint } = await getEndpoint(port);
  await showMenuWithBack({
    title: `🔑 ${key.name}`,
    breadcrumb: [...breadcrumb, key.name],
    headerContent: `Name: ${key.name}\nKey: ${key.key}\nEndpoint: ${endpoint}`,
    items: [
      {
        label: "Copy to Clipboard",
        action: async () => {
          await handleCopyKey(key);
          return true;
        }
      },
      {
        label: "Delete Key",
        action: async () => {
          await handleDeleteKey(key);
          return false;
        }
      }
    ]
  });
}

async function showApiKeysMenu(port, breadcrumb = []) {
  const { showListMenu } = require("../utils/menuHelper");
  
  const { endpoint } = await getEndpoint(port);
  await showListMenu({
    title: "🔑 API Keys Management",
    breadcrumb,
    headerContent: `Endpoint: ${endpoint}`,
    fetchItems: async () => {
      const result = await api.getApiKeys();
      if (!result.success) {
        clearScreen();
        showStatus(`Failed to fetch API keys: ${result.error}`, "error");
        await pause();
        return null;
      }
      return { items: result.data.keys || [] };
    },
    formatItem: (key) => `${key.name} (${maskKey(key.key)})`,
    onSelect: async (key) => {
      await showKeyActions(key, port, breadcrumb);
    },
    createAction: {
      label: "Create New API Key",
      action: async () => {
        await handleCreateKey();
      }
    }
  });
}

module.exports = {
  showApiKeysMenu
};
