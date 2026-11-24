
import { matchPattern } from "./pricing.js";
import REGISTRY from "./registry/index.js";
import { looksLikeVisionModel } from "./visionPatterns.js";

const own = (table, key) => !!table && Object.hasOwn(table, key);

export const DEFAULT_CAPABILITIES = {
  vision: false,
  pdf: false,
  audioInput: false,
  videoInput: false,
  imageOutput: false,
  audioOutput: false,
  search: false,
  tools: true,
  reasoning: false,
  thinkingFormat: null,
  thinkingCanDisable: true,
  thinkingRange: null,
  thinkingEffortSupported: false,
  contextWindow: 200000,
  maxOutput: 64000,
};

const SERVICE_KIND_CAPABILITIES = {
  imageToText: { vision: true },
  image: { imageOutput: true },
  stt: { audioInput: true },
  tts: { audioOutput: true },
  embedding: { tools: false },
};

export function capabilitiesFromServiceKind(kind) {
  return SERVICE_KIND_CAPABILITIES[kind] || null;
}

export const MODEL_CAPABILITIES = {
  "claude-fable-5-1": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 },
  "claude-fable-5-2": { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5-5": { vision: true, pdf: true, reasoning: true, tools: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5": { vision: true, pdf: true, reasoning: true, tools: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5-5": { vision: true, pdf: true, reasoning: true, tools: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-haiku-5-5": { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5":     { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5-thinking-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.6":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.7":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-7":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.8":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-6":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-8":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.8-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-8-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-4.6": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-4-6": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5-thinking-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5-5":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5.5":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5-5": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5.5": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-haiku-5-5":  { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-haiku-5.5":  { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-fable-5":    { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget", contextWindow: 1000000, maxOutput: 128000 },

  "gpt-image-1":       { imageOutput: true, tools: false },

  "gpt-6.2-astra":     { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-6.2-sol":       { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-6.1-terra":     { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "hy4":               { vision: true, reasoning: true, thinkingFormat: "hunyuan", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 64000 },
  "hy4-flash":         { vision: true, reasoning: true, thinkingFormat: "hunyuan", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 64000 },

  "glm-5.3-flash":     { vision: true, videoInput: true, pdf: true, reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 131072 },
  "glm-4.6v":          { vision: true, videoInput: true, reasoning: true, thinkingFormat: "zai", contextWindow: 128000, maxOutput: 32768 },
  "glm-4.5v":          { vision: true, videoInput: true, reasoning: true, thinkingFormat: "zai", contextWindow: 64000, maxOutput: 16384 },
  "glm-5.3-flash-free": { vision: true, videoInput: true, pdf: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 },

  "deepseek-v4-flash-vision-exp": { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 },

  "deepseek-v4.1-flash": { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 },
  "deepseek-v4-1-flash": { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 },
  "deepseek-flash":      { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 },

  "vision-model":      { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000 },
  "coder-model":       { reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000 },

  "kimi-k3":           { vision: true, videoInput: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 131072 },
  "k3":                { vision: true, videoInput: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 131072 },
  "kimi-k3.1-pro":     { vision: true, videoInput: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 131072 },
  "k3.1-pro":          { vision: true, videoInput: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 131072 },
  "k3.1-pro-highspeed": { vision: true, videoInput: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 131072 },
  "kimi-for-coding":   { vision: true, videoInput: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 262144, maxOutput: 65536 },
  "kimi-for-coding-highspeed": { vision: true, videoInput: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 262144, maxOutput: 65536 },
  "kimi-k2.7-code":    { vision: true, videoInput: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 262144, maxOutput: 65536 },
  "kimi-k2.7-code-highspeed": { vision: true, videoInput: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 262144, maxOutput: 65536 },
  "muse-spark-1.2-contributor-free": { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 131072 },
  "muse-spark-1.3-contributor-free": { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 131072 },
  "union-alpha": { vision: true, contextWindow: 262144, maxOutput: 131072 },
  "space-bunny-free":  { vision: true, videoInput: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 524288 },
  "space-bunny":       { vision: true, videoInput: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 524288 },
  "big-pickle":        { reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 32000 },
  "exo-free":          { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 131072 },
  "fledge-alpha-free": { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 131072 },
  "longcat-2.0":             { reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 131072 },
  "longcat-2.0-free":        { reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 131072 },
  "longcat-2.5-preview-free":{ vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 131072 },
  "north-mini-code-free":    { reasoning: true, thinkingFormat: "openai", contextWindow: 256000, maxOutput: 64000 },
  "ring-2.6-1t-free":        { reasoning: true, thinkingFormat: "openai", contextWindow: 262000, maxOutput: 66000 },
  "x-preview-f-free":        { vision: true, videoInput: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 131072 },
  "longcat-2.5-free":        { reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 262144 },
  "iceman-free":             { reasoning: true, thinkingFormat: "openai", contextWindow: 262144, maxOutput: 131072 },
  "inkling-2-small-free":    { reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 131072 },
  "beam-free":               { reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 131072 },
  "flint-40b-free":          { reasoning: true, thinkingFormat: "openai", contextWindow: 262144, maxOutput: 65536 },
  "nemotron-3.5-super-vl-free": { reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 131072 },
  "jev-1.13-free":           { reasoning: false, thinkingFormat: "openai", contextWindow: 64000, maxOutput: 32000 },
  "nemotron-3.5-lightning-free": { reasoning: true, thinkingFormat: "openai", contextWindow: 262144, maxOutput: 262144 },
  "hy4-flash-free":          { reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 65536 },
  "tidepool-alpha-free":     { reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 131072 },
};

const KIRO_GPT_5_6_CAPABILITIES = { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: 128000 };

const CODEX_GPT_56_SOL_CAPS  = { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 372000, maxOutput: 128000 };
const CODEX_GPT_56_DEFAULT_CAPS = { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: 128000 };

const DEVIN_CLI_GPT_CAPS = { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 128000 };

export const PROVIDER_CAPABILITIES = {
  "mistral": {
    "mistral-large-latest": { vision: true, contextWindow: 1048576 },
    "mistral-large-4": { vision: true, contextWindow: 1048576 },
    "mistral-large-4-0": { vision: true, contextWindow: 1048576 },
  },
  "nvidia": {
    "nvidia/nemotron-3.5-bolt-e4b": { tools: true, contextWindow: 128000, maxOutput: 8192 },
    "nvidia/nemotron-3.5-lightning-30b-a3b": { tools: false, reasoning: true, thinkingFormat: "openai", contextWindow: 128000, maxOutput: 8192 },
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": { tools: false, reasoning: true, thinkingFormat: "openai", contextWindow: 128000, maxOutput: 8192 },
    "nvidia/nemotron-3-ultra-550b-a55b": { tools: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 8192 },
    "poolside/laguna-xs-2.1": { tools: true, contextWindow: 200000, maxOutput: 32000 },
    "meta/llama-guard-4-12b": { tools: false, contextWindow: 128000, maxOutput: 4096 },
    "nvidia/riva-translate-4b-instruct-v2": { tools: false, contextWindow: 128000, maxOutput: 4096 },
    "meta/llama-3.3-70b-instruct": { tools: true, contextWindow: 128000, maxOutput: 4096 },
    "minimaxai/minimax-m2.7": { tools: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 131072 },
    "minimaxai/minimax-m3": { tools: false, vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 512000, maxOutput: 131072 },
    "z-ai/glm-5.2": { tools: false, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 128000 },
    "deepseek-ai/deepseek-v4-pro": { tools: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 65536 },
    "deepseek-ai/deepseek-v4-flash": { tools: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 65536 },
  },
  "opencode-go": {
    "gpt-5.6-luna": { vision: true, reasoning: true, search: true, thinkingFormat: "openai-responses", contextWindow: 272000, maxOutput: 128000 },
    "glm-5.3-flash": { vision: true, videoInput: true, pdf: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 131072 },
  },
  "opencode": {
    "mimo-v2.6-flash-free": { vision: true, audioInput: true, videoInput: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 1048576, maxOutput: 131072 },
    "deepseek-v4.1-flash-free": { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 330000, maxOutput: 128000 },
  },
  "codex": {
    "gpt-6-astra":               { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: 128000 },
    "gpt-6.2-astra":             { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: 128000 },
    "gpt-6-sol":                 CODEX_GPT_56_SOL_CAPS,
    "gpt-6-luna":                CODEX_GPT_56_DEFAULT_CAPS,
    "gpt-5.6-sol":               CODEX_GPT_56_SOL_CAPS,
    "gpt-5.6-sol-review":        CODEX_GPT_56_SOL_CAPS,
    "gpt-5.6-terra":             CODEX_GPT_56_DEFAULT_CAPS,
    "gpt-5.6-terra-review":      CODEX_GPT_56_DEFAULT_CAPS,
    "gpt-5.6-luna":              CODEX_GPT_56_DEFAULT_CAPS,
    "gpt-5.6-luna-review":       CODEX_GPT_56_DEFAULT_CAPS,
  },
  "kiro": {
    "gpt-5.6-sol": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-terra": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-luna": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-sol-thinking": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-terra-thinking": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-luna-thinking": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-sol-agentic": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-terra-agentic": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-luna-agentic": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-sol-thinking-agentic": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-terra-thinking-agentic": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-luna-thinking-agentic": KIRO_GPT_5_6_CAPABILITIES,
  },
  "devin-cli": {
    "gpt-5.4-high": DEVIN_CLI_GPT_CAPS,
    "gpt-5.4-medium": DEVIN_CLI_GPT_CAPS,
    "gpt-5.4-low": DEVIN_CLI_GPT_CAPS,
    "gpt-5.5-xhigh": DEVIN_CLI_GPT_CAPS,
    "gpt-5.5-high": DEVIN_CLI_GPT_CAPS,
    "gpt-5.5-medium": DEVIN_CLI_GPT_CAPS,
    "gpt-5.5-low": DEVIN_CLI_GPT_CAPS,
  },
  "codebuddy-cn": {
    "glm-5.2":            { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 1000000, maxOutput: 48000 },
    "glm-5.1":            { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 48000 },
    "glm-5.0":            { reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 48000 },
    "glm-5v-turbo":       { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 64000 },
    "glm-4.7":            { reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 48000 },
    "minimax-m3":         { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 512000, maxOutput: 128000 },
    "kimi-k2.7":          { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 256000, maxOutput: 32000 },
    "kimi-k2.6":          { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 256000, maxOutput: 32000 },
    "hy3":                { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 192000, maxOutput: 64000 },
    "hy4-preview":        { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 64000 },
    "glm-5.3":            { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 1000000, maxOutput: 48000 },
    "glm-5.3-flash":      { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 1000000, maxOutput: 32000 },
    "kimi-k3-1":          { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 32000 },
    "deepseek-v4-pro":    { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 1000000, maxOutput: 50000 },
    "deepseek-v4.1-flash": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 1000000, maxOutput: 128000 },
  },
  "codebuddy-intl": {
    "deepseek-v4.1-flash": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 1000000, maxOutput: 128000 },
  },
  "qoder": {
    "ultimate":       { vision: true, reasoning: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 },
    "performance":    { vision: true, reasoning: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 },
    "dmodel":         { reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },
    "dfmodel":        { reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },
    "gmodel":         { reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 },
    "gfmodel":        { vision: true, reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 },
    "kmodel_latest":  { vision: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },
    "kmodel":         { vision: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 256000, maxOutput: 65536 },
    "mmodel":         { reasoning: true, thinkingFormat: "minimax", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 512000 },
    "qmodel_latest":  { vision: true, reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },
    "qmodel":         { vision: true, reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },
    "qfmodel":        { vision: true, reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },
    "qmodel_38max":   { vision: true, reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },
  },
  "poolside": {
    "laguna-s-2.1":  { reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 32000 },
    "laguna-xs-2.1": { reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 32000 },
  },
  "alitp-intl": {
    "auto":              { tools: true },
    "qwen4-max":         { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 393216 },
    "qwen4-max-preview": { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 393216 },
    "qwen3.8-max":       { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 131072 },
    "qwen3.8-flash":     { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 131072 },
    "qwen3.7-max":       { vision: false, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 131072 },
    "qwen3.7-plus":      { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 131072 },
    "deepseek-v4-pro-0813": { reasoning: true, thinkingFormat: "deepseek", thinkingEffortSupported: true, contextWindow: 1000000, maxOutput: 393216 },
    "qwen3.8-max-preview": { reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 },
    "qwen3.6-flash":     { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 },
    "glm-5.3":           { reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, thinkingEffortSupported: true, contextWindow: 1000000, maxOutput: 131072 },
    "glm-5.2":           { reasoning: true, thinkingFormat: "zai", thinkingEffortSupported: true, contextWindow: 1000000, maxOutput: 128000 },
    "deepseek-v4-pro":   { reasoning: true, thinkingFormat: "deepseek", thinkingEffortSupported: true, contextWindow: 1000000, maxOutput: 384000 },
    "deepseek-v4-flash-0731": { reasoning: true, thinkingFormat: "deepseek", thinkingEffortSupported: true, contextWindow: 1000000, maxOutput: 384000 },
    "deepseek-v4.1-flash": { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 },
    "deepseek-v4.1-flash-1017": { vision: true, reasoning: true, thinkingFormat: "deepseek", thinkingEffortSupported: true, contextWindow: 1000000, maxOutput: 128000 },
  },
  "ollama": {
    "deepseek-v4.1-flash:cloud": { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 },
  },
};

PROVIDER_CAPABILITIES["qoder-cn"] = PROVIDER_CAPABILITIES["qoder"];
PROVIDER_CAPABILITIES.cx = PROVIDER_CAPABILITIES.codex;
PROVIDER_CAPABILITIES.dv = PROVIDER_CAPABILITIES["devin-cli"];
PROVIDER_CAPABILITIES.devin = PROVIDER_CAPABILITIES["devin-cli"];

const SENSENOVA_INTL_CHAT = {
  vision: true,
  reasoning: true,
  tools: true,
  thinkingFormat: "openai",
  contextWindow: 262144,
  maxOutput: 65536,
};
PROVIDER_CAPABILITIES["sensenova-intl"] = {
  "sensenova-6.8-flash": SENSENOVA_INTL_CHAT,
  "sensenova-6.8-flash-lite": SENSENOVA_INTL_CHAT,
  "sensenova-6.7-flash-lite": SENSENOVA_INTL_CHAT,
};

const SYNTHETIC_TEXT = {
  vision: false, reasoning: true, tools: true, thinkingFormat: "openai",
  contextWindow: 524288, maxOutput: 65536,
};
const SYNTHETIC_VISION = { ...SYNTHETIC_TEXT, vision: true };
PROVIDER_CAPABILITIES.synthetic = {
  "hf:zai-org/GLM-5.3": SYNTHETIC_TEXT,
  "hf:zai-org/GLM-5.3-Flash": SYNTHETIC_VISION,
  "hf:zai-org/GLM-4.7-Flash": { ...SYNTHETIC_TEXT, contextWindow: 196608 },
  "hf:moonshotai/Kimi-K3": SYNTHETIC_VISION,
  "hf:moonshotai/Kimi-K3.1-Pro": SYNTHETIC_VISION,
  "hf:deepseek-ai/DeepSeek-V4.1-Flash": SYNTHETIC_VISION,
  "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017": SYNTHETIC_VISION,
  "hf:Qwen/Qwen3.8-27B": { ...SYNTHETIC_VISION, contextWindow: 262144 },
  "hf:openai/gpt-oss-120b": { ...SYNTHETIC_TEXT, contextWindow: 131072 },
  "hf:nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4": SYNTHETIC_TEXT,
  "syn:small:text": { ...SYNTHETIC_TEXT, contextWindow: 196608 },
  "syn:small:vision": SYNTHETIC_VISION,
  "syn:large:text": SYNTHETIC_VISION,
  "syn:large:vision": SYNTHETIC_VISION,
};

PROVIDER_CAPABILITIES["opendesign-go"] = {
  "deepseek-v4.1-flash":          { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 },
  "deepseek-v4-pro":              { reasoning: true, thinkingFormat: "deepseek", thinkingEffortSupported: true, contextWindow: 1000000, maxOutput: 384000 },
  "deepseek-v4-flash":            { reasoning: true, thinkingFormat: "deepseek", thinkingEffortSupported: true, contextWindow: 1000000, maxOutput: 384000 },
  "deepseek-v4-flash-vision-exp": { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 },
  "glm-5.3-flashx":               { reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, thinkingEffortSupported: true, contextWindow: 1000000, maxOutput: 131072 },
  "glm-5.3-flash":                { vision: true, pdf: true, videoInput: true, reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 131072 },
  "glm-5.2":                      { reasoning: true, thinkingFormat: "zai", thinkingEffortSupported: true, contextWindow: 1000000, maxOutput: 128000 },
  "kimi-k3":                      { vision: true, videoInput: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 131072 },
  "kimi-k2.7-code":               { vision: true, videoInput: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 262144, maxOutput: 65536 },
  "mimo-v2.6-flash":              { vision: true, contextWindow: 262144, maxOutput: 131072 },
  "mimo-v2.6-pro":                { vision: true, contextWindow: 262144, maxOutput: 131072 },
  "qwen3.7-max":                  { reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 },
  "hy4-preview":                  { tools: true },
  "gpt-6.1-sol":                  { vision: true, search: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-6-sol":                    { vision: true, search: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-6-astra":                  { vision: true, search: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-6-luna":                   { vision: true, search: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-5.6-terra":                { vision: true, search: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-5.6-sol":                  { vision: true, search: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-5.6-luna":                 { vision: true, search: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "claude-opus-5.5":              { vision: true, search: true, reasoning: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5":                { vision: true, search: true, reasoning: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.8":              { vision: true, search: true, reasoning: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5.5":            { vision: true, search: true, reasoning: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5":              { vision: true, search: true, reasoning: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-haiku-5.5":             { vision: true, search: true, reasoning: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-fable-5.1":             { vision: true, search: true, reasoning: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 },
  "claude-fable-5":               { vision: true, search: true, reasoning: true, thinkingFormat: "claude-budget", contextWindow: 1000000, maxOutput: 128000 },
  "gemini-3.8-flash":             { vision: true, audioInput: true, videoInput: true, search: true, reasoning: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65536 },
  "gemini-3.7-flash":             { vision: true, audioInput: true, videoInput: true, search: true, reasoning: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65536 },
  "grok-4.7":                     { vision: true, search: true, reasoning: true, thinkingFormat: "openai", contextWindow: 500000, maxOutput: 500000 },
  "grok-4.6":                     { vision: true, search: true, reasoning: true, thinkingFormat: "openai", contextWindow: 500000, maxOutput: 500000 },
  "grok-4.5":                     { vision: true, search: true, reasoning: true, thinkingFormat: "openai", contextWindow: 500000 },
};
PROVIDER_CAPABILITIES.deeprelay = {
  "deepseek-v4.1-flash":          { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1048576, maxOutput: 393216 },
  "deepseek-v4-pro":              { reasoning: true, thinkingFormat: "deepseek", thinkingEffortSupported: true, contextWindow: 1048576, maxOutput: 393216 },
  "kimi-k3.1-pro":                { vision: true, videoInput: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 131072 },
  "kimi-k3":                      { vision: true, videoInput: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 131072 },
  "glm-5.3":                      { reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, thinkingEffortSupported: true, contextWindow: 1048576, maxOutput: 131072 },
  "glm-5.3-flash":                { vision: true, pdf: true, videoInput: true, reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 131072 },
  "glm-5.2":                      { reasoning: true, thinkingFormat: "zai", thinkingEffortSupported: true, contextWindow: 1048576, maxOutput: 131072 },
  "qwen3.8-max":                  { reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 131072 },
  "qwen3.8-flash":                { reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 131072 },
  "qwen3.7-max":                  { reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 131072 },
  "qwen3.7-plus":                 { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 131072 },
  "qwen3.6-plus":                 { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 },
  "qwen3.5-9b":                   { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 262144, maxOutput: 65536 },
  "minimax-m3.1-flash":           { vision: true, reasoning: true, thinkingFormat: "minimax", contextWindow: 1048576, maxOutput: 524288 },
  "muse-spark-open-816b-a42b":    { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 131072 },
  "muse-glimmer-30b":             { contextWindow: 131072, maxOutput: 16384 },
  "gpt-oss-120b":                 { reasoning: true, thinkingFormat: "openai", contextWindow: 131072, maxOutput: 8192 },
};

PROVIDER_CAPABILITIES["cloudflare-ai"] = {
  "@cf/cloudflare/clef": { tools: false, contextWindow: 65536 },
  "@cf/cloudflare/clef-flash": { tools: false, contextWindow: 24576 },
  "@cf/cloudflare/clef-omni": { tools: false, vision: true, audioInput: true, videoInput: true, contextWindow: 64000 },
  "@cf/cloudflare/clairic": { tools: false, contextWindow: 65536 },
  "@cf/meta/llama-4-scout-17b-16e-instruct": { vision: true, contextWindow: 131000 },
  "@cf/deepseek-ai/deepseek-v4.1-flash-1017": { vision: true, reasoning: true, thinkingFormat: "deepseek", thinkingEffortSupported: true, contextWindow: 1048576, maxOutput: 128000 },
  "@cf/google/gemma-4-26b-a4b-it": { vision: true, contextWindow: 256000 },
  "@cf/zai-org/glm-5.3": { reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, thinkingEffortSupported: true, contextWindow: 1048576, maxOutput: 131072 },
  "@cf/openai/gpt-oss-120b": { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 },
  "@cf/openai/gpt-oss-20b": { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 },
  "@cf/qwen/qwen3.8-27b": { reasoning: true, thinkingFormat: "qwen", contextWindow: 262144 },
};

export const PATTERN_CAPABILITIES = [
  { pattern: "*claude*opus-5*",     caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude*opus-4.6*",   caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
  { pattern: "*claude*opus-4.7*",   caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
  { pattern: "*claude*opus-4.8*",   caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
  { pattern: "*claude*sonnet-4.6*", caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
  { pattern: "*claude*sonnet-4.7*", caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
  { pattern: "*claude*sonnet-5*",   caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude*haiku*",  caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },
  { pattern: "*claude*opus*",   caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },
  { pattern: "*claude*sonnet*", caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },
  { pattern: "*claude*fable*",  caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude*mythos*", caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude-3*",      caps: { vision: true } },
  { pattern: "*claude*",        caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },

  { pattern: "*gemini*image*",  caps: { vision: true, imageOutput: true, contextWindow: 1048576 } },
  { pattern: "*gemini-4-hydrogen*", caps: { vision: true, pdf: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-4*",      caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-3.8*",    caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-3.7*",    caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-3*pro*",  caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65535 } },
  { pattern: "*gemini-3*",      caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-2.5*",    caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-budget", thinkingRange: { min: 0, max: 24576 }, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-2*",      caps: { vision: true, audioInput: true, videoInput: true, search: true, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini*",        caps: { vision: true, search: true, contextWindow: 1048576 } },
  { pattern: "*gemma*",         caps: { vision: true, contextWindow: 128000 } },
  { pattern: "*nanobanana*",    caps: { vision: true, imageOutput: true } },

  { pattern: "*gpt-6*",         caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 } },

  { pattern: "*gpt-5*image*",   caps: { imageOutput: true } },
  { pattern: "*gpt-5.3-codex-spark*", caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 128000, maxOutput: 32000 } },
  { pattern: "*gpt-5.3-codex*", caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 400000, maxOutput: 128000 } },
  { pattern: "*gpt-5*codex*",   caps: { reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 400000, maxOutput: 128000 } },
  { pattern: "*gpt-5.4-mini*",  caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 400000, maxOutput: 128000 } },
  { pattern: "*gpt-5.4-nano*",  caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 400000, maxOutput: 128000 } },
  { pattern: "*gpt-5.4*",       caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 } },
  { pattern: "*gpt-5.5*",       caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 } },
  { pattern: "*gpt-5.6*",       caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 } },
  { pattern: "*gpt-5*",         caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 400000, maxOutput: 128000 } },
  { pattern: "*gpt-4o*",        caps: { vision: true, search: true, contextWindow: 128000, maxOutput: 16384 } },
  { pattern: "*gpt-4.1*",       caps: { vision: true, contextWindow: 1000000, maxOutput: 32768 } },
  { pattern: "*gpt-4-turbo*",   caps: { vision: true, contextWindow: 128000 } },
  { pattern: "*gpt-4*",         caps: { contextWindow: 128000 } },
  { pattern: "*gpt-3.5*",       caps: { contextWindow: 16385, maxOutput: 4096 } },
  { pattern: "*gpt-oss*",       caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 } },

  { pattern: "*o1-mini*",       caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 } },
  { pattern: "*o1*",            caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 100000 } },
  { pattern: "*o3*",            caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 100000 } },
  { pattern: "*o4*",            caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 100000 } },

  { pattern: "*grok*image*",    caps: { imageOutput: true } },
  { pattern: "*grok-code*",     caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 256000 } },
  { pattern: "*grok-4.6*",      caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 500000, maxOutput: 500000 } },
  { pattern: "*grok-4.5*",      caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 500000, maxOutput: 64000 } },
  { pattern: "*grok-4.7*",      caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 500000, maxOutput: 500000 } },
  { pattern: "*grok-4.3*",      caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 30000 } },
  { pattern: "*grok-build*",    caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 256000, maxOutput: 256000 } },
  { pattern: "*grok-4*",        caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 256000 } },
  { pattern: "*grok-3*",        caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 131072 } },
  { pattern: "*grok*",          caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 256000 } },

  { pattern: "*qwen*vl*",       caps: { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 262144 } },
  { pattern: "*qwen*omni*",     caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 262144, maxOutput: 65536 } },
  { pattern: "*qwen*coder*",    caps: { reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000 } },
  { pattern: "*qwen*max*",      caps: { reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 } },
  { pattern: "*qwen3.5*",       caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 } },
  { pattern: "*qwen3.6*",       caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 } },
  { pattern: "*qwen3.7*",       caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 } },
  { pattern: "*qwen*plus*",     caps: { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 } },
  { pattern: "*qwen*235b*",     caps: { reasoning: true, thinkingFormat: "qwen", contextWindow: 262144 } },
  { pattern: "*qwen-3.8-27b*",  caps: { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 131072, maxOutput: 40960 } },
  { pattern: "*qwq*",           caps: { reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false, contextWindow: 131072 } },
  { pattern: "*qwen*",          caps: { reasoning: true, thinkingFormat: "qwen", contextWindow: 262144 } },

  { pattern: "*kimi*k3*",       caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 131072 } },
  { pattern: "*kimi*for-coding*", caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 262144, maxOutput: 65536 } },
  { pattern: "*kimi*k2.7*code*", caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 262144, maxOutput: 65536 } },
  { pattern: "*kimi*k2*",       caps: { vision: true, reasoning: true, thinkingFormat: "kimi", contextWindow: 262144, maxOutput: 262144 } },
  { pattern: "*kimi*",          caps: { reasoning: true, thinkingFormat: "kimi", contextWindow: 262144 } },

  { pattern: "*glm-5.3*",       caps: { reasoning: true, thinkingFormat: "zai", thinkingEffortSupported: true, thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 131072 } },
  { pattern: "*glm-5.2*",       caps: { reasoning: true, thinkingFormat: "zai", thinkingEffortSupported: true, contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*glm-5*",         caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000, maxOutput: 128000 } },
  { pattern: "*glm-4.7*",       caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000, maxOutput: 128000 } },
  { pattern: "*glm-4*",         caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000 } },
  { pattern: "*glm*",           caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000 } },

  { pattern: "*deepseek-v4.*",  caps: { vision: true, reasoning: true, thinkingFormat: "deepseek", thinkingEffortSupported: true, contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*deepseek-v4*",   caps: { reasoning: true, thinkingFormat: "deepseek", thinkingEffortSupported: true, contextWindow: 1000000, maxOutput: 384000 } },
  { pattern: "*reasoner*",      caps: { reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 128000 } },
  { pattern: "*deepseek-r*",    caps: { reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 128000 } },
  { pattern: "*deepseek-chat*", caps: { contextWindow: 128000 } },
  { pattern: "*deepseek*",      caps: { reasoning: true, thinkingFormat: "deepseek", contextWindow: 128000 } },

  { pattern: "*minimax*image*", caps: { imageOutput: true } },
  { pattern: "*minimax-m3*",    caps: { vision: true, reasoning: true, thinkingFormat: "minimax", contextWindow: 1048576, maxOutput: 512000 } },
  { pattern: "*minimax-m2.7*",  caps: { reasoning: true, thinkingFormat: "minimax", thinkingCanDisable: false, contextWindow: 204800, maxOutput: 131072 } },
  { pattern: "*minimax*",       caps: { reasoning: true, thinkingFormat: "minimax", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 131072 } },

  { pattern: "*mimo*v2.5*",     caps: { vision: true, audioInput: true, videoInput: true, contextWindow: 1048576, maxOutput: 131072 } },
  { pattern: "*mimo*omni*",     caps: { vision: true, audioInput: true, contextWindow: 262144, maxOutput: 131072 } },
  { pattern: "*mimo*",          caps: { vision: true, contextWindow: 262144, maxOutput: 131072 } },

  { pattern: "*llama-4*",       caps: { vision: true, contextWindow: 1000000 } },
  { pattern: "*llama*",         caps: { contextWindow: 128000 } },

  { pattern: "*codestral*",     caps: { contextWindow: 256000 } },
  { pattern: "*mistral-large*", caps: { vision: true, contextWindow: 256000 } },
  { pattern: "*mistral*",       caps: { contextWindow: 128000 } },

  { pattern: "*command-a-vision*", caps: { vision: true, contextWindow: 128000 } },
  { pattern: "*command*",       caps: { contextWindow: 128000 } },

  { pattern: "*sonar-deep-research*",   caps: { search: true, reasoning: true, tools: false, contextWindow: 128000, maxOutput: 32768 } },
  { pattern: "*sonar-reasoning-pro*",   caps: { search: true, reasoning: true, tools: false, vision: true, contextWindow: 128000, maxOutput: 4096 } },
  { pattern: "*sonar*",         caps: { search: true, contextWindow: 128000 } },
  { pattern: "*pplx*",          caps: { search: true, contextWindow: 128000 } },
  { pattern: "*perplexity*",    caps: { search: true, contextWindow: 128000 } },

  { pattern: "*laguna-s-2.1*free*", caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 32000 } },
  { pattern: "*laguna-s-2.1*",  caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 32000 } },
  { pattern: "*laguna-m.1*",    caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 262144, maxOutput: 32000 } },
  { pattern: "*laguna*",        caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 32000 } },

  { pattern: "*muse*spark*",    caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 131072 } },
  { pattern: "*hunyuan*",       caps: { reasoning: true, thinkingFormat: "hunyuan", contextWindow: 262144, maxOutput: 262144 } },
  { pattern: "hy3*",            caps: { reasoning: true, thinkingFormat: "hunyuan", contextWindow: 262144, maxOutput: 262144 } },
  { pattern: "*step-*",         caps: { reasoning: true, thinkingFormat: "step", contextWindow: 128000 } },
  { pattern: "*nemotron*",      caps: { reasoning: true, contextWindow: 128000 } },
  { pattern: "*ling-*",         caps: { reasoning: true, contextWindow: 128000 } },
];

export function aggregateComboCapabilities(comboModels, comboLookup = null, resolveCaps = null, _depth = 0) {
  if (!comboModels?.length || _depth > 6) return null;
  const allCaps = comboModels.map((fullId) => {
    if (!fullId.includes("/") && comboLookup?.[fullId]) {
      return resolveCaps?.(fullId)
          ?? aggregateComboCapabilities(comboLookup[fullId], comboLookup, resolveCaps, _depth + 1)
          ?? getCapabilitiesForModel(null, fullId);
    }
    const slash = fullId.indexOf("/");
    const provider = slash === -1 ? null : fullId.slice(0, slash);
    const model = slash === -1 ? fullId : fullId.slice(slash + 1);
    const local = getCapabilitiesForModel(provider, model);
    const override = resolveCaps?.(fullId);
    return override ? { ...local, ...override } : local;
  });
  const first = allCaps[0];
  return {
    vision:      allCaps.some((c) => c.vision),
    pdf:         allCaps.some((c) => c.pdf),
    audioInput:  allCaps.some((c) => c.audioInput),
    videoInput:  allCaps.some((c) => c.videoInput),
    imageOutput: allCaps.some((c) => c.imageOutput),
    audioOutput: allCaps.some((c) => c.audioOutput),
    search:      allCaps.some((c) => c.search),
    tools:       allCaps.every((c) => c.tools),
    reasoning:          first.reasoning,
    thinkingFormat:     first.thinkingFormat,
    thinkingCanDisable: first.thinkingCanDisable,
    thinkingRange:      first.thinkingRange,
    contextWindow: Math.min(...allCaps.map((c) => c.contextWindow)),
    maxOutput:     Math.max(...allCaps.map((c) => c.maxOutput)),
  };
}

const MODALITY_KEYS = ["vision", "pdf", "audioInput", "videoInput"];

let catalogSource = null;

export function setCatalogSource(source) {
  catalogSource = source;
  if (typeof globalThis !== "undefined") globalThis.__9rCatalogSource = source;
}

function getCatalogSource() {
  if (typeof globalThis === "undefined") return catalogSource;
  return globalThis.__9rCatalogSource || null;
}

export function getProviderLiveData(providerInput, model) {
  const provider = ALIAS_TO_PROVIDER_ID[providerInput] || providerInput;
  if (provider !== "kenari" || !model) return null;
  const source = getCatalogSource();
  if (typeof source?.getProviderLive !== "function") return null;
  try {
    return source.getProviderLive(provider, model) || null;
  } catch {
    return null;
  }
}

function applyProviderLive(result, live) {
  const out = { ...result };
  if (live.contextWindow > 0) out.contextWindow = live.contextWindow;
  if (live.maxOutput > 0) out.maxOutput = live.maxOutput;
  for (const key of MODALITY_KEYS) if (live[key] === true) out[key] = true;
  if (live.reasoning === true) {
    out.reasoning = true;
    if (live.reasoningToggle === false) out.thinkingCanDisable = false;
  }
  return out;
}

function refine(base, provider, model) {
  const result = { ...DEFAULT_CAPABILITIES, ...base };

  const source = getCatalogSource();
  if (source) {
    const modalities = source.getModalities(provider, model);
    if (modalities) {
      for (const key of MODALITY_KEYS) {
        if (modalities[key] === true) result[key] = true;
      }
    }

    const limits = source.getLimits(provider, model);
    if (limits) {
      if (limits.contextWindow > 0) result.contextWindow = limits.contextWindow;
      if (limits.maxOutput > 0) result.maxOutput = limits.maxOutput;
    }
  }

  if (!result.vision && looksLikeVisionModel(model)) result.vision = true;

  return result;
}

const COMMANDCODE_TEXT_ONLY = new Set([
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-v4-flash-fast",
  "zai-org/glm-5.3",
  "zai-org/glm-5.2",
  "zai-org/glm-5.2-fast",
  "zai-org/glm-5.1",
  "zai-org/glm-5",
  "minimaxai/minimax-m2.7",
  "minimax/minimax-m2.7-free",
  "minimaxai/minimax-m2.5",
  "xiaomi/mimo-v2.5-pro",
  "qwen/qwen3.6-max-preview",
  "qwen/qwen3.7-max",
  "meituan/longcat-2.0:free",
  "stepfun/step-3.5-flash",
  "tencent/hy4-preview",
  "tencent/hy3",
  "tencent/hy3-paid",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "poolside/laguna-s-2.1-free",
  "inclusionai/ling-3.0-flash-free",
  "inclusionai/ling-3.0-flash-sante:free",
]);

const ALIAS_TO_PROVIDER_ID = {};
for (const entry of REGISTRY) {
  ALIAS_TO_PROVIDER_ID[entry.id] = entry.id;
  if (entry.alias) ALIAS_TO_PROVIDER_ID[entry.alias] = entry.id;
  for (const alias of entry.aliases || []) ALIAS_TO_PROVIDER_ID[alias] = entry.id;
}

function isCommandCodeTextOnly(model) {
  const key = String(model || "").toLowerCase();
  if (COMMANDCODE_TEXT_ONLY.has(key)) return true;
  for (const id of COMMANDCODE_TEXT_ONLY) {
    const base = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
    if (key === base || key.endsWith("/" + base)) return true;
  }
  return false;
}
export function getCapabilitiesForModel(providerInput, model) {
  if (!model) return { ...DEFAULT_CAPABILITIES };

  const provider = ALIAS_TO_PROVIDER_ID[providerInput] || providerInput;
  const resolved = resolveFromTables(provider, model);
  const live = getProviderLiveData(provider, model);
  return live ? applyProviderLive(resolved, live) : resolved;
}

function resolveFromTables(provider, model) {

  const baseModel = model.includes("/") ? model.split("/").pop() : model;

  if (provider === "commandcode" || provider === "cmc") {
    const providerCaps = PROVIDER_CAPABILITIES.commandcode;
    if (own(providerCaps, model)) return { ...DEFAULT_CAPABILITIES, ...providerCaps[model] };
    if (own(providerCaps, baseModel)) return { ...DEFAULT_CAPABILITIES, ...providerCaps[baseModel] };
    return {
      ...DEFAULT_CAPABILITIES,
      reasoning: true,
      thinkingFormat: "commandcode",
      thinkingEffortSupported: true,
      vision: !isCommandCodeTextOnly(model),
      contextWindow: 1000000,
      maxOutput: 384000,
    };
  }

  if (provider) {
    const providerCaps = PROVIDER_CAPABILITIES[provider];
    if (own(providerCaps, model)) return { ...DEFAULT_CAPABILITIES, ...providerCaps[model] };
    if (own(providerCaps, baseModel)) return { ...DEFAULT_CAPABILITIES, ...providerCaps[baseModel] };
  }

  if (own(MODEL_CAPABILITIES, baseModel)) return refine(MODEL_CAPABILITIES[baseModel], provider, model);
  if (own(MODEL_CAPABILITIES, model)) return refine(MODEL_CAPABILITIES[model], provider, model);
  if (own(MODEL_CAPABILITIES, model)) return refine(MODEL_CAPABILITIES[model], provider, model);

  for (const { pattern, caps } of PATTERN_CAPABILITIES) {
    if (matchPattern(pattern, baseModel) || matchPattern(pattern, model)) {
      return refine(caps, provider, model);
    }
  }

  return refine(null, provider, model);
}

export function isGemini4Model(model) {
  return /(?:^|\/)gemini-4(?:$|[-.])/i.test(String(model || ""));
}
