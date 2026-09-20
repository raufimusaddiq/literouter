import { AntigravityExecutor } from "./antigravity.js";
import { AzureExecutor } from "./azure.js";
import { GeminiCLIExecutor } from "./gemini-cli.js";
import { GithubExecutor } from "./github.js";
import { IFlowExecutor } from "./iflow.js";
import { QoderExecutor } from "./qoder.js";
import { KiroExecutor } from "./kiro.js";
import { KimchiExecutor } from "./kimchi.js";
import { CodexExecutor } from "./codex.js";
import { CursorExecutor } from "./cursor.js";
import { VertexExecutor } from "./vertex.js";
import { OpenCodeExecutor } from "./opencode.js";
import { OpenCodeGoExecutor } from "./opencode-go.js";
import { GrokWebExecutor } from "./grok-web.js";
import { GrokCliExecutor } from "./grok-cli.js";
import { PerplexityWebExecutor } from "./perplexity-web.js";
import { OllamaLocalExecutor } from "./ollama-local.js";
import { CommandCodeExecutor } from "./commandcode.js";
import { XiaomiTokenplanExecutor } from "./xiaomi-tokenplan.js";
import { XiaomiMimoExecutor } from "./xiaomi-mimo.js";
import { MimoFreeExecutor } from "./mimo-free.js";
import { CodeBuddyExecutor } from "./codebuddy-cn.js";
import { CodeBuddyIntlExecutor } from "./codebuddy-intl.js";
import TraeExecutor from "./trae.js";
import ZedExecutor from "./zed.js";
import WindsurfExecutor from "./windsurf.js";
import { DevinCliExecutor } from "./devin-cli.js";
import { DefaultExecutor } from "./default.js";

// getExecutor is a long-standing synchronous public API used by provider tests,
// CLI consumers, and internal call sites. Preserve that contract while avoiding
// construction of every specialized executor at module load.
const factories = {
  antigravity: () => new AntigravityExecutor(),
  azure: () => new AzureExecutor(),
  "gemini-cli": () => new GeminiCLIExecutor(),
  github: () => new GithubExecutor(),
  iflow: () => new IFlowExecutor(),
  qoder: () => new QoderExecutor(),
  kiro: () => new KiroExecutor(),
  kimchi: () => new KimchiExecutor(),
  codex: () => new CodexExecutor(),
  cursor: () => new CursorExecutor(),
  vertex: () => new VertexExecutor("vertex"),
  "vertex-partner": () => new VertexExecutor("vertex-partner"),
  opencode: () => new OpenCodeExecutor(),
  "opencode-go": () => new OpenCodeGoExecutor(),
  "grok-web": () => new GrokWebExecutor(),
  "grok-cli": () => new GrokCliExecutor(),
  "perplexity-web": () => new PerplexityWebExecutor(),
  "ollama-local": () => new OllamaLocalExecutor(),
  commandcode: () => new CommandCodeExecutor(),
  "xiaomi-tokenplan": () => new XiaomiTokenplanExecutor(),
  "xiaomi-mimo": () => new XiaomiMimoExecutor(),
  "mimo-free": () => new MimoFreeExecutor(),
  "codebuddy-cn": () => new CodeBuddyExecutor(),
  "codebuddy-intl": () => new CodeBuddyIntlExecutor(),
  trae: () => new TraeExecutor(),
  zed: () => new ZedExecutor(),
  windsurf: () => new WindsurfExecutor(),
  "devin-cli": () => new DevinCliExecutor(),
};

const aliases = {
  cu: "cursor",
  gcli: "grok-cli",
  gb: "grok-cli",
  mmf: "mimo-free",
};

const specializedCache = globalThis.__liteRouterExecutorCache ??= new Map();
const defaultCache = globalThis.__liteRouterDefaultExecutorCache ??= new Map();

function canonicalProvider(provider) {
  return aliases[provider] || provider;
}

export function getExecutor(provider) {
  const id = canonicalProvider(provider);
  const factory = factories[id];
  if (factory) {
    if (!specializedCache.has(id)) specializedCache.set(id, factory());
    return specializedCache.get(id);
  }

  if (!defaultCache.has(id)) defaultCache.set(id, new DefaultExecutor(id));
  return defaultCache.get(id);
}

export function hasSpecializedExecutor(provider) {
  return Boolean(factories[canonicalProvider(provider)]);
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

export { BaseExecutor } from "./base.js";
export { AntigravityExecutor } from "./antigravity.js";
export { AzureExecutor } from "./azure.js";
export { GeminiCLIExecutor } from "./gemini-cli.js";
export { GithubExecutor } from "./github.js";
export { IFlowExecutor } from "./iflow.js";
export { QoderExecutor } from "./qoder.js";
export { KiroExecutor } from "./kiro.js";
export { KimchiExecutor } from "./kimchi.js";
export { CodexExecutor } from "./codex.js";
export { CursorExecutor } from "./cursor.js";
export { VertexExecutor } from "./vertex.js";
export { DefaultExecutor } from "./default.js";
export { OpenCodeExecutor } from "./opencode.js";
export { OpenCodeGoExecutor } from "./opencode-go.js";
export { GrokWebExecutor } from "./grok-web.js";
export { GrokCliExecutor } from "./grok-cli.js";
export { PerplexityWebExecutor } from "./perplexity-web.js";
export { OllamaLocalExecutor } from "./ollama-local.js";
export { CommandCodeExecutor } from "./commandcode.js";
export { XiaomiTokenplanExecutor } from "./xiaomi-tokenplan.js";
export { XiaomiMimoExecutor } from "./xiaomi-mimo.js";
export { MimoFreeExecutor } from "./mimo-free.js";
export { CodeBuddyExecutor } from "./codebuddy-cn.js";
export { CodeBuddyIntlExecutor } from "./codebuddy-intl.js";
export { default as TraeExecutor } from "./trae.js";
export { default as ZedExecutor } from "./zed.js";
export { default as WindsurfExecutor } from "./windsurf.js";
export { DevinCliExecutor } from "./devin-cli.js";
