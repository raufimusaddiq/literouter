
export const MODEL_PRICING = {
  "claude-opus-4-6":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  },
  "claude-opus-4-5-20251101":     { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  },
  "claude-sonnet-4-6":            { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  },
  "claude-sonnet-4-5-20250929":   { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  },
  "claude-haiku-4-5-20251001":    { input: 1.00,  output: 5.00,  cached: 0.10,  reasoning: 5.00,   cache_creation: 1.25  },
  "claude-sonnet-4-20250514":     { input: 3.00,  output: 15.00, cached: 1.50,  reasoning: 15.00,  cache_creation: 3.00  },
  "claude-opus-4-20250514":       { input: 15.00, output: 25.00, cached: 7.50,  reasoning: 112.50, cache_creation: 15.00 },
  "claude-3-5-sonnet-20241022":   { input: 3.00,  output: 15.00, cached: 1.50,  reasoning: 15.00,  cache_creation: 3.00  },
  "claude-haiku-4.5":             { input: 0.50,  output: 2.50,  cached: 0.05,  reasoning: 3.75,   cache_creation: 0.50  },
  "claude-opus-4.1":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-opus-4.5":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-opus-4.6":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-sonnet-4":              { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  "claude-sonnet-4.5":            { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  "claude-sonnet-4.6":            { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  "claude-opus-4-5-thinking":     { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-opus-4-6-thinking":     { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-fable-5-2":             { input: 8.00,  output: 40.00, cached: 0.20,  reasoning: 40.00,  cache_creation: 10.00 },
  "claude-sonnet-5-5":            { input: 2.00,  output: 10.00, cached: 0.10,  reasoning: 10.00,  cache_creation: 2.50  },
  "claude-sonnet-5":              { input: 2.00,  output: 10.00, cached: 0.20,  reasoning: 10.00,  cache_creation: 2.50  },
  "claude-opus-5-5":              { input: 4.00,  output: 20.00, cached: 0.20,  reasoning: 20.00,  cache_creation: 5.00  },
  "claude-fable-5-1":             { input: 10.00, output: 50.00, cached: 1.00,  reasoning: 50.00,  cache_creation: 12.50 },
  "claude-fable-5":               { input: 10.00, output: 50.00, cached: 1.00,  reasoning: 50.00,  cache_creation: 12.50 },
  "claude-haiku-5-5":             { input: 0.10,  output: 0.50,  cached: 0.01,  reasoning: 0.50,   cache_creation: 0.125 },

  "o3":                           { input: 2.00,  output: 8.00,  cached: 0.50,  reasoning: 8.00,   cache_creation: 0     },
  "gpt-3.5-turbo":                { input: 0.50,  output: 1.50,  cached: 0.25,  reasoning: 2.25,   cache_creation: 0.50  },
  "gpt-4":                        { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  },
  "gpt-4-turbo":                  { input: 10.00, output: 30.00, cached: 5.00,  reasoning: 45.00,  cache_creation: 10.00 },
  "gpt-4o":                       { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  },
  "gpt-4o-mini":                  { input: 0.15,  output: 0.60,  cached: 0.075, reasoning: 0.90,   cache_creation: 0.15  },
  "gpt-4.1":                      { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  },
  "gpt-5":                        { input: 1.25,  output: 10.00, cached: 0.125, reasoning: 10.00,  cache_creation: 1.25  },
  "gpt-5-mini":                   { input: 0.25,  output: 2.00,  cached: 0.025, reasoning: 2.00,   cache_creation: 0.25  },
  "gpt-5-codex":                  { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  },
  "gpt-5.1":                      { input: 1.25,  output: 10.00, cached: 0.125, reasoning: 10.00,  cache_creation: 1.25  },
  "gpt-5.1-codex":                { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  },
  "gpt-5.1-codex-mini":           { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
  "gpt-5.1-codex-mini-high":      { input: 2.00,  output: 8.00,  cached: 1.00,  reasoning: 12.00,  cache_creation: 2.00  },
  "gpt-5.1-codex-max":            { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  },
  "gpt-5.2":                      { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  },
  "gpt-5.2-codex":                { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  },
  "gpt-5.3-codex":                { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  },
  "gpt-5.3-codex-spark":         { input: 3.00,  output: 12.00, cached: 0.30,  reasoning: 12.00,  cache_creation: 3.00  },
  "gpt-5.6":                      { input: 1.00,  output: 6.00,  cached: 0.10,  reasoning: 6.00,   cache_creation: 1.25  },
  "gpt-5.6-luna":                 { input: 0.20,  output: 1.20,  cached: 0.02,  reasoning: 1.20,   cache_creation: 0.25  },
  "gpt-5.6-terra":                { input: 2.00,  output: 12.00, cached: 0.20,  reasoning: 12.00,  cache_creation: 2.50  },
  "gpt-5.6-sol":                  { input: 4.00,  output: 20.00, cached: 0.40,  reasoning: 20.00,  cache_creation: 5.00  },
  "gpt-6.2-astra":                { input: 8.00,  output: 40.00, cached: 0.40,  reasoning: 40.00,  cache_creation: 10.00 },
  "gpt-6.2-sol":                  { input: 2.00,  output: 10.00, cached: 0.10,  reasoning: 10.00,  cache_creation: 2.50  },
  "gpt-6.1-sol":                  { input: 2.00,  output: 10.00, cached: 0.10,  reasoning: 10.00,  cache_creation: 2.50  },
  "gpt-6.1-terra":                { input: 1.00,  output: 5.00,  cached: 0.05,  reasoning: 5.00,   cache_creation: 1.25  },
  "gpt-6-astra":                  { input: 10.00, output: 50.00, cached: 1.00,  reasoning: 50.00,  cache_creation: 12.50 },
  "gpt-6-sol":                    { input: 2.00,  output: 10.00, cached: 0.20,  reasoning: 10.00,  cache_creation: 2.50  },
  "gpt-6-luna":                   { input: 0.10,  output: 0.50,  cached: 0.01,  reasoning: 0.50,   cache_creation: 0.125 },
  "gpt-5.5":                      { input: 5.00,  output: 30.00, cached: 0.50,  reasoning: 30.00,  cache_creation: 0 },
  "gpt-5.5-pro":                  { input: 30.00, output: 180.00, cached: 0,    reasoning: 180.00, cache_creation: 0 },
  "gpt-5.4":                      { input: 2.50,  output: 15.00, cached: 0.25,  reasoning: 15.00,  cache_creation: 0 },
  "gpt-5.4-pro":                  { input: 30.00, output: 180.00, cached: 0,    reasoning: 180.00, cache_creation: 0 },
  "gpt-5.4-mini":                 { input: 0.75,  output: 4.50,  cached: 0.075, reasoning: 4.50,   cache_creation: 0 },
  "gpt-5.4-nano":                 { input: 0.20,  output: 1.25,  cached: 0.02,  reasoning: 1.25,   cache_creation: 0 },
  "gpt-5.2-pro":                  { input: 21.00, output: 168.00, cached: 0,    reasoning: 168.00, cache_creation: 0 },
  "o1":                           { input: 15.00, output: 60.00, cached: 7.50,  reasoning: 90.00,  cache_creation: 15.00 },
  "o1-mini":                      { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  },

  "gemini-4-carbon":               { input: 4.00,  output: 20.00, cached: 0.20,  reasoning: 20.00,  cache_creation: 0 },
  "gemini-4-argon":                { input: 4.00,  output: 20.00, cached: 0.20,  reasoning: 20.00,  cache_creation: 0 },
  "gemini-4-neon":                 { input: 3.00,  output: 15.00, cached: 0.15,  reasoning: 15.00,  cache_creation: 0 },
  "gemini-4-hydrogen":             { input: 1.50,  output: 7.50,  cached: 0.075, reasoning: 7.50,   cache_creation: 0 },
  "gemini-3.8-flash":              { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.8-flash-high":         { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.8-flash-medium":       { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.8-flash-low":          { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.7-flash":              { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.7-flash-high":         { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.7-flash-medium":       { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.7-flash-low":          { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.6-flash":              { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.6-flash-high":         { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.6-flash-medium":       { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.6-flash-low":          { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.5-flash-lite":         { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.375 },
  "gemini-3.5-flash-high":         { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-3-flash-preview":        { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-3-pro-preview":         { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  },
  "gemini-3.1-pro-low":           { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  },
  "gemini-3.1-pro-high":          { input: 4.00,  output: 18.00, cached: 0.50,  reasoning: 27.00,  cache_creation: 4.00  },
  "gemini-pro-agent":             { input: 4.00,  output: 18.00, cached: 0.50,  reasoning: 27.00,  cache_creation: 4.00  },
  "gemini-3-flash-agent":         { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-3.5-flash-low":         { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-3.5-flash-extra-low":   { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-3-flash":               { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-2.5-pro":               { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  },
  "gemini-2.5-flash":             { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.30  },
  "gemini-2.5-flash-lite":        { input: 0.15,  output: 1.25,  cached: 0.015, reasoning: 1.875,  cache_creation: 0.15  },

  "hy4":                          { input: 0.834, output: 2.501, cached: 0.042, reasoning: 2.501,  cache_creation: 0 },
  "hy4-flash":                    { input: 0.07,  output: 0.281, cached: 0.003, reasoning: 0.281,  cache_creation: 0 },
  "hy4-preview":                  { input: 0.834, output: 2.501, cached: 0.042, reasoning: 2.501,  cache_creation: 0 },

  "qwen3-coder-plus":             { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  "qwen3-coder-flash":            { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },

  "kimi-k3":                      { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.00  },
  "k3":                           { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.00  },
  "k3.1-pro":                     { input: 2.00,  output: 10.00, cached: 0.20,  reasoning: 10.00,  cache_creation: 2.00  },
  "k3.1-pro-highspeed":           { input: 0,     output: 0,     cached: 0,     reasoning: 0,      cache_creation: 0     },
  "kimi-k2.7-code":               { input: 0.95,  output: 4.00,  cached: 0.19,  reasoning: 4.00,   cache_creation: 0.95  },
  "kimi-k2.7-code-highspeed":     { input: 1.90,  output: 8.00,  cached: 0.38,  reasoning: 8.00,   cache_creation: 1.90  },
  "kimi-for-coding":              { input: 0.95,  output: 4.00,  cached: 0.19,  reasoning: 4.00,   cache_creation: 0.95  },
  "kimi-for-coding-highspeed":    { input: 1.90,  output: 8.00,  cached: 0.38,  reasoning: 8.00,   cache_creation: 1.90  },
  "kimi-k2":                      { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  "kimi-k2-thinking":             { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
  "kimi-k2.5":                    { input: 1.20,  output: 4.80,  cached: 0.60,  reasoning: 7.20,   cache_creation: 1.20  },
  "kimi-k2.5-thinking":           { input: 1.80,  output: 7.20,  cached: 0.90,  reasoning: 10.80,  cache_creation: 1.80  },
  "kimi-k2.6":                    { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  "kimi-latest":                  { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },

  "deepseek-chat":                { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-reasoner":            { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-r1":                  { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-v3.2-chat":           { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-v3.2-reasoner":       { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-v4-flash":            { input: 0.15,  output: 0.60,  cached: 0.003,  reasoning: 0.60,   cache_creation: 0.15  },
  "deepseek-v4.1-flash":          { input: 0.15,  output: 0.60,  cached: 0.003,  reasoning: 0.60,   cache_creation: 0.15  },
  "deepseek-flash":               { input: 0.15,  output: 0.60,  cached: 0.003,  reasoning: 0.60,   cache_creation: 0.15  },
  "deepseek-v4-pro":              { input: 0.66,  output: 1.98,  cached: 0.022,  reasoning: 1.98,   cache_creation: 0.66  },

  "glm-4.6":                      { input: 0.60,  output: 2.20,  cached: 0.11,  reasoning: 2.20,   cache_creation: 0 },
  "glm-4.6v":                     { input: 0.30,  output: 0.90,  cached: 0.05,  reasoning: 0.90,   cache_creation: 0 },
  "glm-4.7":                      { input: 0.60,  output: 2.20,  cached: 0.11,  reasoning: 2.20,   cache_creation: 0 },
  "glm-5.3":                      { input: 1.40,  output: 4.40,  cached: 0.26,  reasoning: 4.40,   cache_creation: 0 },
  "glm-5.3-flash":                { input: 0.15,  output: 0.50,  cached: 0.03,  reasoning: 0.50,   cache_creation: 0 },
  "glm-5.2":                      { input: 1.40,  output: 4.40,  cached: 0.26,  reasoning: 4.40,   cache_creation: 0 },
  "glm-5.1":                      { input: 1.40,  output: 4.40,  cached: 0.26,  reasoning: 4.40,   cache_creation: 0 },
  "glm-5":                        { input: 1.00,  output: 3.20,  cached: 0.20,  reasoning: 3.20,   cache_creation: 0 },

  "MiniMax-M3":                   { input: 0.30,  output: 1.20,  cached: 0.06,  reasoning: 1.80,   cache_creation: 0.30  },
  "MiniMax-M2.1":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "MiniMax-M2.5":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "MiniMax-M2.7":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "minimax-m2.1":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "minimax-m2.5":                 { input: 0.60,  output: 2.40,  cached: 0.30,  reasoning: 3.60,   cache_creation: 0.60  },

  "grok-4.7":                     { input: 2.00,  output: 6.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 0 },
  "grok-4.6":                     { input: 2.00,  output: 6.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 0 },
  "grok-4.5":                     { input: 2.00,  output: 6.00,  cached: 0.30,  reasoning: 6.00,   cache_creation: 0 },
  "grok-4.3":                     { input: 1.25,  output: 2.50,  cached: 0.20,  reasoning: 2.50,   cache_creation: 0 },
  "grok-code-fast-1":             { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },

  "auto":                         { input: 2.00,  output: 8.00,  cached: 1.00,  reasoning: 12.00,  cache_creation: 2.00  },

  "oswe-vscode-prime":            { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  "gpt-oss-120b-medium":          { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "vision-model":                 { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
  "coder-model":                  { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
};

export const PROVIDER_PRICING = {
  typesafe: {
    "jev-latest": { input: 0.042, output: 0 },
  },
  cerebras: {
    "gpt-oss-120b": { input: 0.35, output: 0.75, cached: 0, reasoning: 0.75 },
    "qwen-3.8-27b": { input: 0.99, output: 1.49, cached: 0, reasoning: 1.49 },
  },
  groq: {
    "openai/gpt-oss-120b": { input: 0.15, output: 0.60, cached: 0, reasoning: 0.60 },
  },
  synthetic: {
    "hf:zai-org/GLM-5.3":                      { input: 1.40, output: 4.40, cached: 0.26, reasoning: 4.40 },
    "hf:zai-org/GLM-5.3-Flash":                { input: 0.15, output: 0.50, cached: 0.04, reasoning: 0.50 },
    "hf:zai-org/GLM-4.7-Flash":                { input: 0.10, output: 0.50, cached: 0.02, reasoning: 0.50 },
    "hf:moonshotai/Kimi-K3.1-Pro":             { input: 2.00, output: 10.00, cached: 0.20, reasoning: 10.00 },
    "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017": { input: 0.60, output: 1.20, cached: 0.03, reasoning: 1.20 },
    "hf:Qwen/Qwen3.8-27B":                     { input: 0.45, output: 2.20, cached: 0.09, reasoning: 2.20 },
    "hf:openai/gpt-oss-120b":                  { input: 0.10, output: 0.10, cached: 0.02, reasoning: 0.10 },
    "hf:moonshotai/Kimi-K3":                   { input: 0, output: 0, cached: 0, reasoning: 0 },
    "hf:deepseek-ai/DeepSeek-V4.1-Flash":      { input: 0, output: 0, cached: 0, reasoning: 0 },
    "hf:nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "syn:small:text":                          { input: 0.10, output: 0.50, cached: 0.02, reasoning: 0.50 },
    "syn:small:vision":                        { input: 0.60, output: 1.20, cached: 0.03, reasoning: 1.20 },
    "syn:large:text":                          { input: 0.60, output: 1.20, cached: 0.03, reasoning: 1.20 },
    "syn:large:vision":                        { input: 2.00, output: 10.00, cached: 0.20, reasoning: 10.00 },
  },
  "opendesign-go": {
    "deepseek-v4.1-flash":          { input: 0.3, output: 1.2, cached: 0.006, reasoning: 1.2 },
    "deepseek-v4-pro":              { input: 1.32, output: 3.96, cached: 0.044, reasoning: 3.96 },
    "deepseek-v4-flash":            { input: 0.44, output: 1.32, cached: 0.014, reasoning: 1.32 },
    "deepseek-v4-flash-vision-exp": { input: 0.44, output: 1.32, cached: 0.014, reasoning: 1.32 },
    "glm-5.3-flashx":               { input: 0.37, output: 1.25, cached: 0.075, reasoning: 1.25 },
    "glm-5.3-flash":                { input: 0.075, output: 0.25, cached: 0.015, reasoning: 0.25 },
    "glm-5.2":                      { input: 1.4, output: 4.4, cached: 0.26, reasoning: 4.4 },
    "kimi-k3":                      { input: 3, output: 15, cached: 0.3, reasoning: 15 },
    "kimi-k2.7-code":               { input: 0.95, output: 4, cached: 0.19, reasoning: 4 },
    "mimo-v2.6-flash":              { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28 },
    "mimo-v2.6-pro":                { input: 0.435, output: 0.87, cached: 0.0036, reasoning: 0.87 },
    "qwen3.7-max":                  { input: 2.5, output: 7.5, cached: 0.5, reasoning: 7.5, cache_creation: 3.125 },
    "hy4-preview":                  { input: 0.834, output: 2.501, cached: 0.042, reasoning: 2.501 },
    "gpt-6.1-sol":                  { input: 2, output: 10, cached: 0.1, reasoning: 10, cache_creation: 2.5 },
    "gpt-6-sol":                    { input: 2, output: 10, cached: 0.2, reasoning: 10, cache_creation: 2.5 },
    "gpt-6-astra":                  { input: 10, output: 50, cached: 1, reasoning: 50, cache_creation: 12.5 },
    "gpt-6-luna":                   { input: 0.1, output: 0.5, cached: 0.01, reasoning: 0.5, cache_creation: 0.125 },
    "gpt-5.6-terra":                { input: 2, output: 12, cached: 0.2, reasoning: 12, cache_creation: 2.5 },
    "gpt-5.6-sol":                  { input: 4, output: 20, cached: 0.4, reasoning: 20, cache_creation: 5 },
    "gpt-5.6-luna":                 { input: 0.2, output: 1.2, cached: 0.02, reasoning: 1.2, cache_creation: 0.25 },
    "claude-opus-5.5":              { input: 4, output: 20, cached: 0.2, reasoning: 20, cache_creation: 5 },
    "claude-opus-5":                { input: 5, output: 25, cached: 0.5, reasoning: 25, cache_creation: 6.25 },
    "claude-opus-4.8":              { input: 5, output: 25, cached: 0.5, reasoning: 25, cache_creation: 6.25 },
    "claude-sonnet-5.5":            { input: 2, output: 10, cached: 0.2, reasoning: 10, cache_creation: 2.5 },
    "claude-sonnet-5":              { input: 2, output: 10, cached: 0.2, reasoning: 10, cache_creation: 2.5 },
    "claude-haiku-5.5":             { input: 0.1, output: 0.5, cached: 0.01, reasoning: 0.5, cache_creation: 0.125 },
    "claude-fable-5.1":             { input: 10, output: 50, cached: 0.25, reasoning: 50, cache_creation: 12.5 },
    "claude-fable-5":               { input: 10, output: 50, cached: 1, reasoning: 50, cache_creation: 12.5 },
    "gemini-3.8-flash":             { input: 0.75, output: 3.75, cached: 0.075, reasoning: 3.75, cache_creation: 0.08333 },
    "gemini-3.7-flash":             { input: 0.75, output: 3.75, cached: 0.075, reasoning: 3.75 },
    "grok-4.7":                     { input: 2, output: 6, cached: 0.5, reasoning: 6 },
    "grok-4.6":                     { input: 2, output: 6, cached: 0.5, reasoning: 6 },
    "grok-4.5":                     { input: 2, output: 6, cached: 0.5, reasoning: 6 },
  },
  deeprelay: {
    "deepseek-v4.1-flash":          { input: 0.135, output: 0.54, cached: 0.0027, reasoning: 0.54 },
    "deepseek-v4-pro":              { input: 1.32, output: 3.96, cached: 0.13, reasoning: 3.96 },
    "kimi-k3.1-pro":                { input: 2, output: 10, cached: 0.2, reasoning: 10 },
    "kimi-k3":                      { input: 3, output: 15, cached: 0.3, reasoning: 15 },
    "glm-5.3":                      { input: 0.9, output: 2.83, cached: 0.167, reasoning: 2.83 },
    "glm-5.3-flash":                { input: 0.15, output: 0.5, cached: 0.03, reasoning: 0.5 },
    "glm-5.2":                      { input: 0.59, output: 1.92, cached: 0.113, reasoning: 1.92 },
    "qwen3.8-max":                  { input: 2, output: 6, cached: 0.25, reasoning: 6 },
    "qwen3.8-flash":                { input: 0.15, output: 0.47, reasoning: 0.47 },
    "qwen3.7-max":                  { input: 2.5, output: 7.5, cached: 0.5, reasoning: 7.5 },
    "qwen3.7-plus":                 { input: 0.32, output: 1.28, reasoning: 1.28 },
    "qwen3.6-plus":                 { input: 0.5, output: 3, reasoning: 3 },
    "qwen3.5-9b":                   { input: 0.17, output: 0.25, reasoning: 0.25 },
    "minimax-m3.1-flash":           { input: 0.15, output: 0.6, cached: 0.015, reasoning: 0.6 },
    "muse-spark-open-816b-a42b":    { input: 1.25, output: 4.25, cached: 0.15, reasoning: 4.25 },
    "muse-glimmer-30b":             { input: 0.35, output: 1.5, cached: 0.04, reasoning: 1.5 },
    "gpt-oss-120b":                 { input: 0.15, output: 0.6, reasoning: 0.6 },
  },
  "alitp-intl": {
    "auto":                     { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen4-max":                { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen4-max-preview":        { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen3.8-max":              { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen3.8-max-preview":      { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen3.8-flash":            { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen3.7-max":              { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen3.7-plus":             { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen3.6-flash":            { input: 0, output: 0, cached: 0, reasoning: 0 },
    "glm-5.3":                  { input: 0, output: 0, cached: 0, reasoning: 0 },
    "glm-5.2":                  { input: 0, output: 0, cached: 0, reasoning: 0 },
    "deepseek-v4-pro":          { input: 0, output: 0, cached: 0, reasoning: 0 },
    "deepseek-v4-pro-0813":     { input: 0, output: 0, cached: 0, reasoning: 0 },
    "deepseek-v4-flash-0731":   { input: 0, output: 0, cached: 0, reasoning: 0 },
    "deepseek-v4.1-flash":      { input: 0, output: 0, cached: 0, reasoning: 0 },
    "deepseek-v4.1-flash-1017": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  commandcode: {
    "stepfun/Step-3.5-Flash": { input: 0.09, output: 0.30, cached: 0.02, reasoning: 0.30 },
  },
  "sensenova-intl": {
    "sensenova-6.8-flash":      { input: 0, output: 0, cached: 0, reasoning: 0 },
    "sensenova-6.8-flash-lite": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "sensenova-6.7-flash-lite": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  "cloudflare-ai": {
    "@cf/cloudflare/clef": { input: 0.24, output: 0 },
    "@cf/cloudflare/clef-flash": { input: 0.038, output: 0 },
    "@cf/cloudflare/clef-omni": { input: 0.15, output: 0 },
    "@cf/cloudflare/clairic": { input: 0.24, output: 0 },
    "@cf/meta/llama-4-scout-17b-16e-instruct": { input: 0.27, output: 0.85, reasoning: 0.85 },
    "@cf/deepseek-ai/deepseek-v4.1-flash-1017": { input: 0.30, output: 1.20, cached: 0.006, reasoning: 1.20 },
    "@cf/google/gemma-4-26b-a4b-it": { input: 0.10, output: 0.30, reasoning: 0.30 },
    "@cf/zai-org/glm-5.3": { input: 1.40, output: 4.40, cached: 0.26, reasoning: 4.40 },
    "@cf/openai/gpt-oss-120b": { input: 0.35, output: 0.75, reasoning: 0.75 },
    "@cf/openai/gpt-oss-20b": { input: 0.20, output: 0.30, reasoning: 0.30 },
    "@cf/qwen/qwen3.8-27b": { input: 0.45, output: 3.20, cached: 0.05, reasoning: 3.20 },
  },
  gh: {
    "gpt-5.3-codex": { input: 1.75, output: 14.00, cached: 0.175, reasoning: 14.00, cache_creation: 1.75 },
  },
  tokenrouter: {
    "MiniMax-M3": { input: 0.3, output: 1.2, cached: 0.06, reasoning: 1.2 },
    "anthropic/claude-fable-5": { input: 10, output: 50, cached: 1.0, cache_creation: 12.5, reasoning: 50 },
    "anthropic/claude-haiku-4.5": { input: 1.0, output: 5.0, cached: 0.1, cache_creation: 1.25, reasoning: 5.0 },
    "anthropic/claude-opus-4.5": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-4.6": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-4.7": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-4.7-fast": { input: 30, output: 150, cached: 3.0, reasoning: 150 },
    "anthropic/claude-opus-4.8": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-4.8-fast": { input: 10, output: 50, cached: 1.0, cache_creation: 12.5, reasoning: 50 },
    "anthropic/claude-opus-5": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-5-fast": { input: 10, output: 50, cached: 1.0, cache_creation: 12.5, reasoning: 50 },
    "anthropic/claude-sonnet-4": { input: 3.0, output: 15.0, cached: 0.3, cache_creation: 3.75, reasoning: 15.0 },
    "anthropic/claude-sonnet-4.5": { input: 3.0, output: 15.0, cached: 0.3, cache_creation: 3.75, reasoning: 15.0 },
    "anthropic/claude-sonnet-4.6": { input: 3.0, output: 15.0, cached: 0.3, cache_creation: 3.75, reasoning: 15.0 },
    "anthropic/claude-sonnet-5": { input: 2, output: 10, cached: 0.2, reasoning: 10 },
    "claude-opus-4-8-m-aws": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "deepseek/deepseek-v3.2": { input: 0.26, output: 0.38, cached: 0.13, reasoning: 0.38 },
    "deepseek/deepseek-v4-flash": { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28 },
    "deepseek/deepseek-v4-flash-0731": { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28 },
    "deepseek/deepseek-v4-pro": { input: 0.435, output: 0.87, cached: 0.003625, reasoning: 0.87 },
    "ex/gpt-5.4": { input: 2.5, output: 15.0, cached: 0.25, reasoning: 15.0 },
    "google/gemini-2.5-flash-image": { input: 0.3, output: 2.5, reasoning: 2.5 },
    "google/gemini-3-flash-preview": { input: 0.5, output: 3.0, cached: 0.05, cache_creation: 0.08333, reasoning: 3.0 },
    "google/gemini-3-pro-image-preview": { input: 2, output: 12, reasoning: 12 },
    "google/gemini-3.1-flash-image-preview": { input: 0.5, output: 3.0, reasoning: 3.0 },
    "google/gemini-3.1-flash-lite-image": { input: 0.25, output: 1.5, reasoning: 1.5 },
    "google/gemini-3.1-pro-preview": { input: 2, output: 12, cached: 0.2, cache_creation: 0.375, reasoning: 12 },
    "google/gemini-3.5-flash": { input: 1.5, output: 9.0, cached: 0.15, cache_creation: 0.08333, reasoning: 9.0 },
    "google/gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cached: 0.03, cache_creation: 0.08333, reasoning: 2.5 },
    "google/gemini-3.6-flash": { input: 1.5, output: 7.5, cached: 0.15, cache_creation: 0.08333, reasoning: 7.5 },
    "google/gemini-embedding-2": { input: 1.0, output: 6.0, cached: 0.1, reasoning: 6.0 },
    "google/gemma-4-26b-a4b-it": { input: 0.06, output: 0.33, reasoning: 0.33 },
    "kling-3.0-turbo": { input: 2.1, output: 2.1, reasoning: 2.1 },
    "microsoft/mai-image-2.5": { input: 5.0, output: 47.0, reasoning: 47.0 },
    "minimax/minimax-m2-her": { input: 0.3, output: 1.2, cached: 0.03, reasoning: 1.2 },
    "minimax/minimax-m2.1": { input: 0.3, output: 1.2, cached: 0.03, reasoning: 1.2 },
    "minimax/minimax-m2.1-highspeed": { input: 0.6, output: 2.4, cached: 0.06, reasoning: 2.4 },
    "minimax/minimax-m2.5": { input: 0.3, output: 1.2, cached: 0.03, reasoning: 1.2 },
    "minimax/minimax-m2.7": { input: 0.3, output: 1.2, cached: 0.06, reasoning: 1.2 },
    "minimax/minimax-m2.7-highspeed": { input: 0.6, output: 2.4, cached: 0.06, reasoning: 2.4 },
    "miromind/mirothinker-1-7-deepresearch": { input: 4, output: 25.0, reasoning: 25.0 },
    "miromind/mirothinker-1-7-deepresearch-mini": { input: 1.25, output: 10.0, reasoning: 10.0 },
    "mistralai/devstral-2512": { input: 0.4, output: 2.0, cached: 0.04, reasoning: 2.0 },
    "mistralai/mistral-medium-3-5": { input: 1.5, output: 7.5, reasoning: 7.5 },
    "mistralai/mistral-small-2603": { input: 0.15, output: 0.6, cached: 0.015, reasoning: 0.6 },
    "mistralai/voxtral-small-24b-2507": { input: 0.1, output: 0.3, cached: 0.01, reasoning: 0.3 },
    "moonshotai/kimi-k2.5": { input: 0.6, output: 3.0, cached: 0.1, reasoning: 3.0 },
    "moonshotai/kimi-k2.6": { input: 0.95, output: 4.0, cached: 0.16, reasoning: 4.0 },
    "moonshotai/kimi-k2.7-code": { input: 0.9286, output: 3.8571, cached: 0.1857, reasoning: 3.8571 },
    "moonshotai/kimi-k3": { input: 3.0, output: 15.0, cached: 0.3, reasoning: 15.0 },
    "nvidia/nemotron-3-super-120b-a12b": { input: 0.3, output: 0.9, cached: 0.1, reasoning: 0.9 },
    "openai/gpt-4o-mini": { input: 0.15, output: 0.6, cached: 0.075, reasoning: 0.6 },
    "openai/gpt-5": { input: 1.25, output: 10.0, cached: 0.125, reasoning: 10.0 },
    "openai/gpt-5-image": { input: 10, output: 40, cached: 2.5, reasoning: 40 },
    "openai/gpt-5-image-mini": { input: 2.5, output: 8.0, cached: 0.25, reasoning: 8.0 },
    "openai/gpt-5-mini": { input: 0.25, output: 2.0, cached: 0.025, reasoning: 2.0 },
    "openai/gpt-5.2": { input: 1.75, output: 14.0, cached: 0.175, reasoning: 14.0 },
    "openai/gpt-5.3-codex": { input: 1.75, output: 14.0, cached: 0.175, reasoning: 14.0 },
    "openai/gpt-5.4": { input: 2.5, output: 15.0, cached: 0.25, reasoning: 15.0 },
    "openai/gpt-5.4-image-2": { input: 8, output: 30.0, cached: 2.0, reasoning: 30.0 },
    "openai/gpt-5.4-mini": { input: 0.75, output: 4.5, cached: 0.075, reasoning: 4.5 },
    "openai/gpt-5.4-nano": { input: 0.2, output: 1.25, cached: 0.02, reasoning: 1.25 },
    "openai/gpt-5.4-pro": { input: 30, output: 180, reasoning: 180 },
    "openai/gpt-5.5": { input: 5.0, output: 30.0, cached: 0.5, reasoning: 30.0 },
    "openai/gpt-5.5-pro": { input: 30, output: 180, reasoning: 180 },
    "openai/gpt-5.6-luna": { input: 0.2, output: 1.2, cached: 0.02, cache_creation: 0.25, reasoning: 1.2 },
    "openai/gpt-5.6-sol": { input: 5.0, output: 30.0, cached: 0.5, cache_creation: 6.25, reasoning: 30.0 },
    "openai/gpt-5.6-terra": { input: 2, output: 12, cached: 0.2, cache_creation: 2.5, reasoning: 12 },
    "openai/gpt-audio": { input: 2.5, output: 10.0, reasoning: 10.0 },
    "openai/gpt-audio-mini": { input: 0.6, output: 2.4, reasoning: 2.4 },
    "openai/gpt-oss-120b": { input: 0.039, output: 0.18, reasoning: 0.18 },
    "qwen/qwen3-coder-next": { input: 0.12, output: 0.75, cached: 0.06, reasoning: 0.75 },
    "qwen/qwen3.5-122b-a10b": { input: 0.26, output: 2.08, reasoning: 2.08 },
    "qwen/qwen3.5-35b-a3b": { input: 0.1625, output: 1.3, reasoning: 1.3 },
    "qwen/qwen3.5-397b-a17b": { input: 0.39, output: 2.34, reasoning: 2.34 },
    "qwen/qwen3.5-9b": { input: 0.1, output: 0.15, reasoning: 0.15 },
    "qwen/qwen3.5-flash": { input: 0.1048, output: 0.4194, reasoning: 0.4194 },
    "qwen/qwen3.5-plus-02-15": { input: 0.26, output: 1.56, reasoning: 1.56 },
    "qwen/qwen3.6-plus": { input: 0.54, output: 3.21, reasoning: 3.21 },
    "qwen/qwen3.7-max": { input: 1.25, output: 3.75, cached: 0.25, reasoning: 3.75 },
    "qwen/qwen3.7-plus": { input: 0.4, output: 1.6, cached: 0.08, reasoning: 1.6 },
    "qwen/qwen3.8-max": { input: 2, output: 6, cached: 0.25, cache_creation: 2.5, reasoning: 6 },
    "qwen3.5-omni-plus": { input: 1.0, output: 5.7143, reasoning: 5.7143 },
    "qwen3.6-flash": { input: 0.171, output: 1.029, cached: 0.017, cache_creation: 0.214, reasoning: 1.029 },
    "sakana/fugu-ultra": { input: 5.0, output: 30.0, cached: 0.5, reasoning: 30.0 },
    "seed-2-0-code-preview-260328": { input: 1.0, output: 6.0, cached: 0.2, cache_creation: 0.008333, reasoning: 6.0 },
    "seed-2-0-lite-260428": { input: 0.5, output: 4.0, cached: 0.1, cache_creation: 0.008333, reasoning: 4.0 },
    "seed-2-0-mini-260428": { input: 0.2, output: 0.8, cached: 0.04, cache_creation: 0.00833, reasoning: 0.8 },
    "seed-2-0-pro-260328": { input: 1.0, output: 6.0, cached: 0.2, cache_creation: 0.008333, reasoning: 6.0 },
    "stepfun/step-3.5-flash": { input: 0.1, output: 0.3, cached: 0.02, reasoning: 0.3 },
    "stepfun/step-3.7-flash": { input: 0.2, output: 1.15, cached: 0.04, reasoning: 1.15 },
    "tencent/hy3-preview": { input: 0.066, output: 0.26, cached: 0.029, reasoning: 0.26 },
    "x-ai/grok-4.1-fast": { input: 0.2, output: 0.5, cached: 0.05, reasoning: 0.5 },
    "x-ai/grok-4.20-beta": { input: 2, output: 6, cached: 0.2, reasoning: 6 },
    "x-ai/grok-4.3": { input: 1.25, output: 2.5, cached: 0.2, reasoning: 2.5 },
    "x-ai/grok-4.5": { input: 2, output: 6, cached: 0.5, reasoning: 6 },
    "x-ai/grok-build-0.1": { input: 1.0, output: 2.0, cached: 0.2, reasoning: 2.0 },
    "xiaomi/mimo-v2-flash": { input: 0.1, output: 0.3, cached: 0.01, reasoning: 0.3 },
    "xiaomi/mimo-v2-omni": { input: 0.4, output: 2.0, cached: 0.08, reasoning: 2.0 },
    "xiaomi/mimo-v2-pro": { input: 1.0, output: 3.0, cached: 0.2, reasoning: 3.0 },
    "xiaomi/mimo-v2.5": { input: 0.4, output: 2.0, cached: 0.08, reasoning: 2.0 },
    "xiaomi/mimo-v2.5-pro": { input: 1.0, output: 3.0, cached: 0.2, reasoning: 3.0 },
    "z-ai/glm-4.5-air": { input: 0.13, output: 0.85, cached: 0.025, reasoning: 0.85 },
    "z-ai/glm-4.6": { input: 0.6, output: 2.2, cached: 0.11, reasoning: 2.2 },
    "z-ai/glm-4.6v": { input: 0.3, output: 0.9, reasoning: 0.9 },
    "z-ai/glm-4.7": { input: 0.6, output: 2.2, cached: 0.11, reasoning: 2.2 },
    "z-ai/glm-5": { input: 1.0, output: 3.2, cached: 0.2, reasoning: 3.2 },
    "z-ai/glm-5-turbo": { input: 1.2, output: 4.0, cached: 0.24, reasoning: 4.0 },
    "z-ai/glm-5.1": { input: 1.05, output: 3.5, cached: 0.525, reasoning: 3.5 },
    "z-ai/glm-5.2": { input: 1.4, output: 4.4, cached: 0.26, reasoning: 4.4 },
    "z-ai/glm-5.3-free": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
};

const BACKFILL_PRICING = {
  cerebras: {
    "zai-glm-4.7": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "llama-3.3-70b": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "llama-4-scout-17b-16e-instruct": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  "cloudflare-ai": {
    "@cf/meta/llama-3.2-1b-instruct": { input: 0.027, output: 0.201, cached: 0, reasoning: 0.201 },
    "@cf/meta/llama-3.2-3b-instruct": { input: 0.051, output: 0.335, cached: 0, reasoning: 0.335 },
    "@cf/meta/llama-3.1-8b-instruct-fp8-fast": { input: 0.045, output: 0.384, cached: 0, reasoning: 0.384 },
    "@cf/meta/llama-3.1-8b-instruct-awq": { input: 0.123, output: 0.266, cached: 0, reasoning: 0.266 },
    "@cf/mistralai/mistral-small-3.1-24b-instruct": { input: 0.351, output: 0.555, cached: 0, reasoning: 0.555 },
    "@cf/meta/llama-3.1-70b-instruct-fp8-fast": { input: 0.293, output: 2.253, cached: 0, reasoning: 2.253 },
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { input: 0.293, output: 2.253, cached: 0, reasoning: 2.253 },
    "@cf/qwen/qwq-32b": { input: 0.66, output: 1, cached: 0, reasoning: 1 },
  },
  cohere: {
    "command-r-plus-08-2024": { input: 2.5, output: 10, cached: 0, reasoning: 10 },
    "command-r-08-2024": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "command-a-03-2025": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  fireworks: {
    "accounts/fireworks/models/llama-v3p3-70b-instruct": { input: 0.9, output: 0.9, cached: 0, reasoning: 0.9 },
  },
  gemini: {
    "gemma-4-31b-it": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  groq: {
    "llama-3.3-70b-versatile": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "meta-llama/llama-4-maverick-17b-128e-instruct": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  hyperbolic: {
    "meta-llama/Llama-3.3-70B-Instruct": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "meta-llama/Llama-3.2-3B-Instruct": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "NousResearch/Hermes-3-Llama-3.1-70B": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  mistral: {
    "mistral-large-latest": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "codestral-latest": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mistral-medium-latest": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  nebius: {
    "meta-llama/Llama-3.3-70B-Instruct": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  nvidia: {
    "nvidia/nemotron-3.5-lightning-30b-a3b": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "nvidia/nemotron-3.5-bolt-e4b": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "nvidia/nemotron-3-ultra-550b-a55b": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "poolside/laguna-xs-2.1": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "meta/llama-guard-4-12b": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "nvidia/riva-translate-4b-instruct-v2": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "meta/llama-3.3-70b-instruct": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  ollama: {
    "gpt-oss:120b": { input: 0.15, output: 0.6, cached: 0.014, reasoning: 0.6 },
  },
  openai: {
    "o3": { input: 2, output: 8, cached: 0.5, reasoning: 8 },
  },
  siliconflow: {
    "openai/gpt-oss-120b": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "inclusionAI/Ling-flash-2.0": { input: 0.14, output: 0.57, cached: 0, reasoning: 0.57 },
  },
  together: {
    "meta-llama/Llama-3.3-70B-Instruct-Turbo": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8": { input: 0.27, output: 0.85, cached: 0, reasoning: 0.85 },
  },
  venice: {
    "venice-uncensored-1-2": { input: 0.2, output: 0.9, cached: 0, reasoning: 0.9 },
    "zai-org-glm-5": { input: 1, output: 3.2, cached: 0.2, reasoning: 3.2 },
    "llama-3.3-70b": { input: 0.7, output: 2.8, cached: 0, reasoning: 2.8 },
    "hermes-3-llama-3.1-405b": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mistral-small-3-2-24b-instruct": { input: 0.09375, output: 0.25, cached: 0, reasoning: 0.25 },
  },
  "api-airforce": {
    "gpt-oss-120b": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "gpt-oss-20b": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  cline: {
    "kwaipilot/kat-coder-pro": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  clinepass: {
    "cline-pass/mimo-v2.5": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "cline-pass/mimo-v2.5-pro": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  cursor: {
    "default": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  github: {
    "goldeneye-free-auto": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  kimchi: {
    "nemotron-3-ultra-fp4": { input: 0.6, output: 3.6, cached: 0, reasoning: 3.6 },
  },
  "opencode-go": {
    "ox-alpha-free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "longcat-2.0": { input: 0.3, output: 1.2, cached: 0.006, reasoning: 1.2 },
    "mimo-v2.5": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mimo-v2.5-pro": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "hy3": { input: 0.14, output: 0.58, cached: 0.035, reasoning: 0.58 },
    "muse-spark-1.2-contributor": { input: 0.1, output: 0.2, cached: 0.002, reasoning: 0.2 },
    "muse-spark-1.3-contributor": { input: 0.1, output: 0.2, cached: 0.002, reasoning: 0.2 },
  },
  opencode: {
    "muse-spark-1.2-contributor-free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "muse-spark-1.3-contributor-free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "union-alpha": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "longcat-2.5-free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "iceman-free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "inkling-2-small-free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "beam-free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "flint-40b-free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "nemotron-3.5-super-vl-free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "jev-1.13-free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "nemotron-3.5-lightning-free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "hy4-flash-free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "tidepool-alpha-free": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  "perplexity-web": {
    "pplx-auto": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "pplx-sonar": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "pplx-gpt": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "pplx-gemini": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "pplx-sonnet": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "pplx-opus": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "pplx-nemotron": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  perplexity: {
    "sonar-pro": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "sonar-reasoning-pro": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "sonar-deep-research": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "sonar": { input: 0.25, output: 2.50, cached: 0.0625, reasoning: 2.50 },
  },
  "perplexity-agent": {
    "perplexity/sonar": { input: 0.25, output: 2.5, cached: 0.0625, reasoning: 2.5 },
    "nvidia/nemotron-3-super-120b-a12b": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  qoder: {
    "ultimate": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "performance": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "efficient": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "lite": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qmodel_38max": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qmodel_latest": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qmodel": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qfmodel": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "kmodel_latest": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "kmodel": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "gmodel": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "gfmodel": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "dmodel": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "dfmodel": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mmodel": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  bazaarlink: {
    "auto:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mimo-v2.5-pro": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mimo-v2.5": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "nemotron-3-super-120b-a12b": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  "kilo-gateway": {
    "kilo-auto/free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "nvidia/nemotron-3-super-120b-a12b:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "nvidia/nemotron-3-ultra-550b-a55b:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "kwaipilot/kat-coder-pro-v2.5:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "kilo-auto/frontier": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "kilo-auto/balanced": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  morph: {
    "morph-v3-large": { input: 0.9, output: 1.9, cached: 0, reasoning: 1.9 },
    "morph-v3-fast": { input: 0.8, output: 1.2, cached: 0, reasoning: 1.2 },
    "morph-qwen35-397b": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "morph-minimax27-230b": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "morph-qwen36-27b": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "morph-dsv4flash": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  poolside: {
    "poolside/laguna-s-2.1": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "poolside/laguna-xs-2.1": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "poolside/laguna-m.1": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  kenari: {
    "agnes-2-0-flash:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "agnes-2-5-flash:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "agnes-3-0-flash:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "gemma-4-31b-it": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "gpt-oss-120b": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "gpt-oss-20b": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "hy3": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "hy3:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "laguna-s-2-1:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "laguna-xs-2-1:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mimo-v2-5": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mimo-v2-5-pro": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mimo-v2-5:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mistral-medium-3-5:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "muse-spark-1-2": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "muse-spark-1-2-contributor": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "muse-spark-1-2-contributor:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "muse-spark-1-3": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "muse-spark-1-3-contributor": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "muse-spark-1-3-contributor:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "nemotron-3-super-120b-a12b": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "nemotron-3-super-120b-a12b:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "nemotron-3-ultra-550b-a55b": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "nemotron-3-ultra-550b-a55b:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "nex-n2-5-pro:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "north-mini-code:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "step-3-7-flash": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "step-3-7-flash:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  muse: {
    "muse-spark-1.2-contributor": { input: 0.1, output: 0.2, cached: 0.002, reasoning: 0.2 },
    "muse-spark-1.3-contributor": { input: 0.1, output: 0.2, cached: 0.002, reasoning: 0.2 },
  },
  byteplus: {
    "seed-2-0-pro-260328": { input: 0.5, output: 3, cached: 0.1, reasoning: 3 },
    "seed-2-0-code-preview-260328": { input: 0.5, output: 3, cached: 0.1, reasoning: 3 },
    "seed-2-0-mini-260215": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "seed-2-0-lite-260228": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "gpt-oss-120b-250805": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  "codebuddy-cn": {
    "hy3": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  iflow: {
    "iflow-rome-30ba3b": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  mmf: {
    "mimo-auto": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  "volcengine-ark": {
    "Doubao-Seed-2.0-Code": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "Doubao-Seed-2.0-pro": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "Doubao-Seed-2.0-lite": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "Doubao-Seed-Code": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  "xiaomi-mimo": {
    "mimo-x-pro-preview": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mimo-x-flash-preview": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mimo-v2.5-pro": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mimo-v2.5": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mimo-v2-omni": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mimo-v2-flash": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  "xiaomi-tokenplan": {
    "mimo-v2.6-pro": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mimo-v2.6-flash": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mimo-v2.5-asr": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mimo-v2.5-tts": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mimo-v2.5-tts-voiceclone": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mimo-v2.5-tts-voicedesign": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  "codebuddy-intl": {
    "hy3-preview": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
  tencent: {
    "hunyuan-turbos-latest": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "hunyuan-t1-latest": { input: 0, output: 0, cached: 0, reasoning: 0 },
  },
};
for (const [provider, table] of Object.entries(BACKFILL_PRICING)) {
  PROVIDER_PRICING[provider] = { ...table, ...PROVIDER_PRICING[provider] };
}

export const PATTERN_PRICING = [
  { pattern: "*-codex-xhigh",   pricing: { input: 10.00, output: 40.00, cached: 5.00,  reasoning: 60.00,  cache_creation: 10.00 } },
  { pattern: "*-codex-high",    pricing: { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  } },
  { pattern: "*-codex-max",     pricing: { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  } },
  { pattern: "*-codex-mini-*",  pricing: { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  } },
  { pattern: "*-codex-mini",    pricing: { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  } },
  { pattern: "*-codex-low",     pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: "*-codex-none",    pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: "*-codex-spark",   pricing: { input: 3.00,  output: 12.00, cached: 0.30,  reasoning: 12.00,  cache_creation: 3.00  } },
  { pattern: "codex-*",         pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: "*-codex",         pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },

  { pattern: "claude-opus-*",   pricing: { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  } },
  { pattern: "claude-sonnet-*", pricing: { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  } },
  { pattern: "claude-haiku-*",  pricing: { input: 1.00,  output: 5.00,  cached: 0.10,  reasoning: 5.00,   cache_creation: 1.25  } },
  { pattern: "claude-*",        pricing: { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  } },

  { pattern: "gemini-*-flash-lite", pricing: { input: 0.15, output: 1.25, cached: 0.015, reasoning: 1.875, cache_creation: 0.15 } },
  { pattern: "gemini-*-flash",  pricing: { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.30  } },
  { pattern: "gemini-*-pro",    pricing: { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  } },
  { pattern: "gemini-4-hydrogen*", pricing: { input: 1.50, output: 7.50, cached: 0.075, reasoning: 7.50, cache_creation: 1.50 } },
  { pattern: "gemini-4-*",      pricing: { input: 4.00,  output: 20.00, cached: 0.20,  reasoning: 20.00,  cache_creation: 0.1875 } },
  { pattern: "gemini-3-*",      pricing: { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  } },
  { pattern: "gemini-2.5-*",    pricing: { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.30  } },
  { pattern: "gemini-*",        pricing: { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  } },

  { pattern: "gpt-5.6-*",       pricing: { input: 2.50,  output: 15.00, cached: 0.25,  reasoning: 15.00,  cache_creation: 2.50  } },
  { pattern: "gpt-5.3-*",       pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: "gpt-5.2-*",       pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: "gpt-5.1-*",       pricing: { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  } },
  { pattern: "gpt-5-*",         pricing: { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  } },
  { pattern: "gpt-5*",          pricing: { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  } },
  { pattern: "gpt-4o-*",        pricing: { input: 0.15,  output: 0.60,  cached: 0.075, reasoning: 0.90,   cache_creation: 0.15  } },
  { pattern: "gpt-4o",          pricing: { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  } },
  { pattern: "gpt-4*",          pricing: { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  } },

  { pattern: "o1-*",            pricing: { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  } },
  { pattern: "o1",              pricing: { input: 15.00, output: 60.00, cached: 7.50,  reasoning: 90.00,  cache_creation: 15.00 } },
  { pattern: "o3-*",            pricing: { input: 10.00, output: 40.00, cached: 5.00,  reasoning: 60.00,  cache_creation: 10.00 } },
  { pattern: "o4-*",            pricing: { input: 2.00,  output: 8.00,  cached: 1.00,  reasoning: 12.00,  cache_creation: 2.00  } },

  { pattern: "qwen3-coder-*",   pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },
  { pattern: "qwen*-coder-*",   pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },
  { pattern: "qwen*",           pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },

  { pattern: "kimi-*-thinking",  pricing: { input: 1.80,  output: 7.20,  cached: 0.90,  reasoning: 10.80,  cache_creation: 1.80  } },
  { pattern: "kimi-k3*",        pricing: { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.00  } },
  { pattern: "kimi-k2*",        pricing: { input: 1.20,  output: 4.80,  cached: 0.60,  reasoning: 7.20,   cache_creation: 1.20  } },
  { pattern: "kimi-*",          pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },

  { pattern: "deepseek-*reasoner*", pricing: { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28, cache_creation: 0.14 } },
  { pattern: "deepseek-r*",     pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  } },
  { pattern: "deepseek-v*",     pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  } },
  { pattern: "deepseek-*",      pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  } },

  { pattern: "glm-5*",          pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },
  { pattern: "glm-4*",          pricing: { input: 0.75,  output: 3.00,  cached: 0.375, reasoning: 4.50,   cache_creation: 0.75  } },
  { pattern: "glm-*",           pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },

  { pattern: "MiniMax-*",       pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },
  { pattern: "minimax-*",       pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },

  { pattern: "grok-code-*",     pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },
  { pattern: "grok-*",          pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },
];

const runtimePricing = new Map();
const RUNTIME_PRICING_MAX_MODELS = 1000;
const RUNTIME_RATE_MAX = 1000;
const RUNTIME_RATE_FIELDS = ["input", "output", "cached", "cache_creation", "reasoning"];

function isSaneRate(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= RUNTIME_RATE_MAX;
}

function sanitizePricing(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (!isSaneRate(entry.input) || !isSaneRate(entry.output)) return null;
  const out = { input: entry.input, output: entry.output };
  for (const field of RUNTIME_RATE_FIELDS.slice(2)) {
    if (isSaneRate(entry[field])) out[field] = entry[field];
  }
  return out;
}

export function setRuntimePricing(provider, entries) {
  if (!provider || !entries || typeof entries !== "object") return;
  const store = Object.create(null);
  for (const [model, entry] of Object.entries(entries).slice(0, RUNTIME_PRICING_MAX_MODELS)) {
    const clean = sanitizePricing(entry);
    if (clean) store[model] = clean;
  }
  runtimePricing.set(provider, store);
}

export function clearRuntimePricing(provider) {
  if (provider) runtimePricing.delete(provider);
  else runtimePricing.clear();
}

const patternRegexCache = new Map();
const PATTERN_REGEX_CACHE_MAX = 1000;
export function matchPattern(pattern, model) {
  let regex = patternRegexCache.get(pattern);
  if (!regex) {
    regex = new RegExp("^" + pattern.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
    if (patternRegexCache.size >= PATTERN_REGEX_CACHE_MAX) patternRegexCache.clear();
    patternRegexCache.set(pattern, regex);
  }
  return regex.test(model);
}

export function getPricingForModel(provider, model) {
  if (!model) return null;

  const overlay = runtimePricing.get(provider);
  if (overlay && Object.hasOwn(overlay, model)) return overlay[model];

  if (provider && Object.hasOwn(PROVIDER_PRICING, provider)) {
    const providerTable = PROVIDER_PRICING[provider];
    if (providerTable && Object.hasOwn(providerTable, model)) return providerTable[model];
  }

  const baseModel = model.includes("/") ? model.split("/").pop() : model;
  if (Object.hasOwn(MODEL_PRICING, baseModel)) return MODEL_PRICING[baseModel];
  if (Object.hasOwn(MODEL_PRICING, model)) return MODEL_PRICING[model];

  for (const { pattern, pricing } of PATTERN_PRICING) {
    if (matchPattern(pattern, baseModel) || matchPattern(pattern, model)) {
      return pricing;
    }
  }

  return null;
}

export function getDefaultPricing() {
  return PROVIDER_PRICING;
}

export function formatCost(cost) {
  if (cost === null || cost === undefined || isNaN(cost)) return "$0.00";
  return `$${cost.toFixed(2)}`;
}

export function calculateCostFromTokens(tokens, pricing) {
  if (!tokens || !pricing) return 0;

  let cost = 0;

  const inputTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
  const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
  const cacheCreationTokens = tokens.cache_creation_input_tokens || 0;
  const nonCachedInput = Math.max(0, inputTokens - cachedTokens - cacheCreationTokens);

  cost += nonCachedInput * (pricing.input / 1000000);

  if (cachedTokens > 0) {
    cost += cachedTokens * ((pricing.cached || pricing.input) / 1000000);
  }

  const outputTokens = tokens.completion_tokens || tokens.output_tokens || 0;
  cost += outputTokens * (pricing.output / 1000000);

  const reasoningTokens = tokens.reasoning_tokens || 0;
  if (reasoningTokens > 0) {
    cost += reasoningTokens * ((pricing.reasoning || pricing.output) / 1000000);
  }

  if (cacheCreationTokens > 0) {
    cost += cacheCreationTokens * ((pricing.cache_creation || pricing.input) / 1000000);
  }

  return cost;
}
