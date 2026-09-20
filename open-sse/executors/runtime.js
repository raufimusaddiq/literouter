import { DefaultExecutor } from "./default.js";

const aliases = {
  cu: "cursor",
  gcli: "grok-cli",
  gb: "grok-cli",
  mmf: "mimo-free",
};

const loaders = {
  antigravity: async () => new (await import("./antigravity.js")).AntigravityExecutor(),
  azure: async () => new (await import("./azure.js")).AzureExecutor(),
  "gemini-cli": async () => new (await import("./gemini-cli.js")).GeminiCLIExecutor(),
  github: async () => new (await import("./github.js")).GithubExecutor(),
  iflow: async () => new (await import("./iflow.js")).IFlowExecutor(),
  qoder: async () => new (await import("./qoder.js")).QoderExecutor(),
  kiro: async () => new (await import("./kiro.js")).KiroExecutor(),
  kimchi: async () => new (await import("./kimchi.js")).KimchiExecutor(),
  codex: async () => new (await import("./codex.js")).CodexExecutor(),
  cursor: async () => new (await import("./cursor.js")).CursorExecutor(),
  vertex: async () => new (await import("./vertex.js")).VertexExecutor("vertex"),
  "vertex-partner": async () => new (await import("./vertex.js")).VertexExecutor("vertex-partner"),
  opencode: async () => new (await import("./opencode.js")).OpenCodeExecutor(),
  "opencode-go": async () => new (await import("./opencode-go.js")).OpenCodeGoExecutor(),
  "grok-web": async () => new (await import("./grok-web.js")).GrokWebExecutor(),
  "grok-cli": async () => new (await import("./grok-cli.js")).GrokCliExecutor(),
  "perplexity-web": async () => new (await import("./perplexity-web.js")).PerplexityWebExecutor(),
  "ollama-local": async () => new (await import("./ollama-local.js")).OllamaLocalExecutor(),
  commandcode: async () => new (await import("./commandcode.js")).CommandCodeExecutor(),
  "xiaomi-tokenplan": async () => new (await import("./xiaomi-tokenplan.js")).XiaomiTokenplanExecutor(),
  "xiaomi-mimo": async () => new (await import("./xiaomi-mimo.js")).XiaomiMimoExecutor(),
  "mimo-free": async () => new (await import("./mimo-free.js")).MimoFreeExecutor(),
  "codebuddy-cn": async () => new (await import("./codebuddy-cn.js")).CodeBuddyExecutor(),
  "codebuddy-intl": async () => new (await import("./codebuddy-intl.js")).CodeBuddyIntlExecutor(),
  trae: async () => new (await import("./trae.js")).default(),
  zed: async () => new (await import("./zed.js")).default(),
  windsurf: async () => new (await import("./windsurf.js")).default(),
  "devin-cli": async () => new (await import("./devin-cli.js")).DevinCliExecutor(),
};

const specializedCache = globalThis.__liteRouterExecutorCache ??= new Map();
const defaultCache = globalThis.__liteRouterDefaultExecutorCache ??= new Map();

function canonicalProvider(provider) {
  return aliases[provider] || provider;
}

export async function getExecutor(provider) {
  const id = canonicalProvider(provider);
  const loader = loaders[id];
  if (!loader) {
    if (!defaultCache.has(id)) defaultCache.set(id, new DefaultExecutor(id));
    return defaultCache.get(id);
  }

  if (!specializedCache.has(id)) {
    // Cache the promise so concurrent first requests for one provider share a
    // single dynamic import/constructor.
    specializedCache.set(id, Promise.resolve().then(loader).catch((error) => {
      specializedCache.delete(id);
      throw error;
    }));
  }
  return specializedCache.get(id);
}

export function hasSpecializedExecutor(provider) {
  return Boolean(loaders[canonicalProvider(provider)]);
}

export function clearExecutorCache(provider = null) {
  if (!provider) {
    specializedCache.clear();
    defaultCache.clear();
    return;
  }
  const id = canonicalProvider(provider);
  specializedCache.delete(id);
  defaultCache.delete(id);
}

export const __executorLoaders = loaders;
