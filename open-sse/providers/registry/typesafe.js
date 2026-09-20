export default {
  id: "typesafe",
  priority: 130,
  alias: "typesafe",
  display: {
    name: "TypeSafe AI",
    icon: "account_tree",
    color: "#E551BA",
    textIcon: "TS",
    website: "https://typesafe.ai",
    notice: {
      apiKeyUrl: "https://console.typesafe.ai",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.typesafe.ai/v1/systemone",
    format: "systemone",
    timeoutMs: 10000,
  },
  models: [
    { id: "jev-latest", name: "Jev (latest)" },
  ],
  serviceKinds: ["systemone"],
};
