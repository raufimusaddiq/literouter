// System One pass-through providers (registry `format: "systemone"`).
// The registration order drives the dashboard list; add new provider specs here.
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
    description: "Typed decision questions answered from a state document.",
    docsUrl: "https://docs.typesafe.ai/api",
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
