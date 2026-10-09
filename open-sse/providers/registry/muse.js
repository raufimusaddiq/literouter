export default {
  id: "muse",
  priority: 126,
  alias: "muse",
  display: {
    name: "Muse",
    icon: "auto_awesome",
    color: "#0668E1",
    textIcon: "M",
    website: "https://api.meta.ai",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.meta.ai/v1/responses",
    format: "openai-responses",
  },
  transports: [
    { format: "openai-responses", baseUrl: "https://api.meta.ai/v1/responses", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
  ],
  models: [
    { id: "muse-spark-1.2-contributor", name: "Muse Spark 1.2 Contributor", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
  ],
  serviceKinds: ["llm"],
};
