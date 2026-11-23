import { getCapabilitiesForModel, getProviderLiveData } from "./capabilities.js";
import { matchPattern } from "./pricing.js";
import { resolveKiroEffortPath } from "../config/kiroConstants.js";

const L = {
  base: ["none", "low", "medium", "high"],
  onOff: ["none", "thinking"],
  openai: ["none", "minimal", "low", "medium", "high", "xhigh"],
  levelMax: ["none", "low", "medium", "high", "max"],
  budgetX: ["none", "low", "medium", "high", "xhigh", "max"],
  gemini: ["minimal", "low", "medium", "high"],
  hiMax: ["none", "high", "max"],
};

const FORMAT_LEVELS = {
  openai: L.openai,
  "openai-responses": ["none", "low", "medium", "high", "xhigh", "max"],
  "claude-adaptive": L.budgetX,
  "claude-budget": L.budgetX,
  "gemini-level": L.gemini,
  "gemini-budget": L.base,
  zai: L.onOff,
  qwen: L.base,
  kimi: L.levelMax,
  deepseek: L.hiMax,
  commandcode: ["none", "low", "medium", "high", "xhigh", "max"],
  minimax: L.onOff,
  hunyuan: L.base,
  step: L.base,
};

const CODEX_GPT_5_6_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

const CLAUDE_NO_XHIGH = ["none", "low", "medium", "high", "max"];

const PATTERN_THINKING = [
  { pattern: "*claude*4.6*", levels: CLAUDE_NO_XHIGH },
  { pattern: "*claude*4-6*", levels: CLAUDE_NO_XHIGH },
  { provider: "codex", pattern: "*gpt-6.1-sol*", levels: ["low", "medium", "high", "xhigh", "max"] },
  { provider: "codex", pattern: "*gpt-6*", levels: CODEX_GPT_5_6_LEVELS },
  { provider: "codex", pattern: "*gpt-5.6-sol*", levels: [...CODEX_GPT_5_6_LEVELS, "ultra"] },
  { provider: "codex", pattern: "*gpt-5.6-terra*", levels: [...CODEX_GPT_5_6_LEVELS, "ultra"] },
  { provider: "codex", pattern: "*gpt-5.6-luna*", levels: CODEX_GPT_5_6_LEVELS },
  { provider: "opencode-go", pattern: "*gpt-5.6-luna*", levels: CODEX_GPT_5_6_LEVELS },
  { pattern: "*codex*", levels: ["low", "medium", "high", "xhigh"] },
  { provider: "opencode", pattern: "*mimo*v2.6*", levels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"] },
  { pattern: "*mimo*v2.6*", levels: ["none", "low", "medium", "high", "xhigh"] },
  { pattern: "*mimo*v2.5-pro*", levels: ["none", "low", "medium", "high", "xhigh"] },
  { pattern: "*deepseek-v4.1-flash-free*", levels: ["low", "high", "max"] },
  { pattern: "*deepseek-v4.*", levels: ["none", "low", "medium", "high", "xhigh", "max"] },
  { provider: "codebuddy-cn", pattern: "glm-5.3*",     levels: ["low", "high", "max"] },
  { provider: "codebuddy-cn", pattern: "glm-5.2",      levels: ["high", "xhigh"] },
  { provider: "codebuddy-cn", pattern: "deepseek-v4*", levels: ["low", "high", "xhigh"] },
  { provider: "codebuddy-cn", pattern: "hy3*",         levels: ["low", "high"] },
  { provider: "codebuddy-cn", pattern: "hy4*",         levels: ["high"] },
  { provider: "codebuddy-intl", pattern: "deepseek-v4*", levels: ["low", "high", "xhigh"] },
];

const OPENAI_MAX_EFFORT_MODEL = /(?:^|\/)gpt-(?:5\.6|6)(?:[.-]|$)/i;
const isOpenAICompatibleNode = (provider) => String(provider || "").startsWith("openai-compatible-");

export function getThinkingLevels(provider, model) {
  if (provider === "kiro" && resolveKiroEffortPath(model) === null) return null;
  const live = getProviderLiveData(provider, model);
  if (live?.reasoning === false) return null;
  if (live?.reasoning === true && live.reasoningLevels?.length) {
    return live.reasoningToggle === true ? ["none", ...live.reasoningLevels] : [...live.reasoningLevels];
  }
  const caps = getCapabilitiesForModel(provider, model);
  if (!caps.reasoning) return null;
  const hit = PATTERN_THINKING.find((entry) =>
    (!entry.provider || entry.provider === provider) && matchPattern(entry.pattern, model)
  );
  const baseId = String(model || "").replace(/\([^()]+\)\s*$/, "");
  let levels = hit?.levels
    || (isOpenAICompatibleNode(provider) && OPENAI_MAX_EFFORT_MODEL.test(baseId) ? CODEX_GPT_5_6_LEVELS : null)
    || FORMAT_LEVELS[caps.thinkingFormat] || L.base;
  if (caps.thinkingCanDisable === false) levels = levels.filter((l) => l !== "none");
  return levels;
}
