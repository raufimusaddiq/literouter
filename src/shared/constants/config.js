import pkg from "../../../package.json" with { type: "json" };

export const APP_CONFIG = {
  name: "LiteRouter",
  description: "Lean AI routing control plane",
  version: pkg.version,
};

export const UPDATER_CONFIG = {
  npmPackageName: "literouter",
  installCmd: "bun add -g literouter",
  installCmdLatest: "bun add -g literouter@latest",
  exitDelayMs: 500,
  statusPort: 20129,
  statusPollIntervalMs: 1000,
  statusLogTailLines: 8,
  installRetries: 3,
  installRetryDelayMs: 5000,
  lingerAfterDoneMs: 30000,
  waitForExitMinMs: 5000,
  waitForExitMaxMs: 20000,
  waitForExitCheckMs: 500,
  appPort: 20128,
};

export const THEME_CONFIG = {
  storageKey: "theme",
  defaultTheme: "system",
};

export const CONSOLE_LOG_CONFIG = {
  maxLines: 200,
  pollIntervalMs: 1000,
};

export const QUOTA_AUTOPING_CONFIG = {
  tickIntervalMs: 60000,
  pingLeadMs: 5000,
  refreshAheadMs: 300000,
  failureCooldownMs: 900000,
  providers: {
    claude: {
      settingsKey: "claudeAutoPing",
      quotaKey: "session (5h)",
      pingModel: "claude-haiku-4-5-20251001",
      pingText: "hi",
      pingMaxTokens: 1,
    },
    codex: {
      settingsKey: "codexAutoPing",
      quotaKey: "session",
      pingWhenResetAtSlides: true,
      resetAtDriftMs: 30000,
      minPingIntervalMs: 600000,
      skipWhenBlockingQuotaExhausted: true,
      pingModel: "gpt-5.6-terra",
      pingText: "hi",
      pingInstructions: "Reply with OK.",
      pingReasoningEffort: "none",
    },
  },
};

export {
  FREE_PROVIDERS,
  OAUTH_PROVIDERS,
  APIKEY_PROVIDERS,
  WEB_COOKIE_PROVIDERS,
  AI_PROVIDERS,
  AUTH_METHODS,
} from "./providers.js";

export {
  PROVIDER_MODELS,
  AI_MODELS,
} from "./models.js";
