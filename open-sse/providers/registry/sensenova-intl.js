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
