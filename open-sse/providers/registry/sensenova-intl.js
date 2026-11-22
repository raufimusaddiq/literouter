// SenseNova international platform (platform.sensenova.ai). Same OpenAI-compatible
// wire as the China site, different host: keys are per-site, and token.sensenova.cn
// rejects international keys (401 "Forbidden"), so this site is its own provider —
// the same split as alicode/alicode-intl.
//
// LiteRouter carries no image-generation handler, so only the chat catalog is
// registered here; the vendor's u1.x image models are not advertised.
export default {
  id: "sensenova-intl",
  priority: 210,
  alias: "sensenova-intl",
  display: {
    name: "SenseNova (Intl)",
    icon: "auto_awesome",
    color: "#5B5CE2",
    textIcon: "SN",
    website: "https://platform.sensenova.ai",
    notice: {
      text: "For international accounts (platform.sensenova.ai). Keys from the China site use a separate host.",
      apiKeyUrl: "https://platform.sensenova.ai",
    },
  },
  category: "apikey",
  thinkingConfig: {
    options: ["none", "low", "medium", "high", "max"],
    defaultMode: "high",
  },
  transport: {
    baseUrl: "https://token.sensenova.ai/v1/chat/completions",
    validateUrl: "https://token.sensenova.ai/v1/models",
    quirks: {
      // Thinking streams as `reasoning` (delta + message), not reasoning_content.
      // stream.js lifts it so OpenAI-shaped clients don't lose reasoning-only chunks.
      reasoningAliasFields: true,
    },
  },
  models: [
    { id: "sensenova-6.8-flash", name: "SenseNova 6.8 Flash" },
    { id: "sensenova-6.8-flash-lite", name: "SenseNova 6.8 Flash Lite" },
    { id: "sensenova-6.7-flash-lite", name: "SenseNova 6.7 Flash Lite" },
  ],
  serviceKinds: ["llm"],
};
