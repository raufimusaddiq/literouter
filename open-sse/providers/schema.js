import { DEFAULT_RETRY_CONFIG, FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";


export const PROVIDER_DEFAULTS = {
  baseUrl: "",
  format: "openai",
  headers: {},
  auth: { header: "Authorization", scheme: "bearer", source: ["accessToken", "apiKey"] },
  forceStream: false,
  urlSuffix: "",
  quirks: {},
  passthroughModels: false,
  retry: DEFAULT_RETRY_CONFIG,
  timeoutMs: FETCH_CONNECT_TIMEOUT_MS,
  executor: "default"
};
