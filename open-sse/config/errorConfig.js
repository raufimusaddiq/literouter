// OpenAI-compatible error types mapping (client-facing)
export const ERROR_TYPES = {
  400: { type: "invalid_request_error", code: "bad_request" },
  401: { type: "authentication_error", code: "invalid_api_key" },
  402: { type: "billing_error", code: "payment_required" },
  403: { type: "permission_error", code: "insufficient_quota" },
  404: { type: "invalid_request_error", code: "model_not_found" },
  406: { type: "invalid_request_error", code: "model_not_supported" },
  408: { type: "server_error", code: "upstream_request_timeout" },
  429: { type: "rate_limit_error", code: "rate_limit_exceeded" },
  500: { type: "server_error", code: "internal_server_error" },
  502: { type: "server_error", code: "bad_gateway" },
  503: { type: "server_error", code: "service_unavailable" },
  504: { type: "server_error", code: "gateway_timeout" }
};

// Default error messages per status code (client-facing)
export const DEFAULT_ERROR_MESSAGES = {
  400: "Bad request",
  401: "Invalid API key provided",
  402: "Payment required",
  403: "You exceeded your current quota",
  404: "Model not found",
  406: "Model not supported",
  408: "Upstream timed out reading the request",
  429: "Rate limit exceeded",
  500: "Internal server error",
  502: "Bad gateway - upstream provider error",
  503: "Service temporarily unavailable",
  504: "Gateway timeout"
};

// Exponential backoff config for rate limits
export const BACKOFF_CONFIG = {
  base: 2000,
  max: 5 * 60 * 1000,
  maxLevel: 15
};

// Default cooldown for transient/unknown errors
export const TRANSIENT_COOLDOWN_MS = 30 * 1000;

// Hard cap for provider-reported rate limit cooldown (e.g. codex resets_at can be 5-6h)
export const MAX_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

// Cooldown durations (ms)
const COOLDOWN = {
  long: 2 * 60 * 1000,
  short: 5 * 1000,
};

/**
 * Failure scope — who the failure is about, which decides what may react to it:
 *   request: the request itself is bad. No account fallback, no lock, no combo fallback.
 *   model:   this model cannot serve the request (e.g. context overflow). No account
 *            fallback and no lock, but a combo may try another model.
 *   account: the credential/provider is unhealthy (default). Lock + account/combo fallback.
 */
export const SCOPE = { request: "request", model: "model", account: "account" };

/**
 * Unified error classification rules.
 * Checked top-to-bottom: text rules first (by order), then status rules.
 * Each rule: { text?, status?, scope?, cooldownMs?, backoff? }
 *   - scope: SCOPE.* (default account)
 *   - text: substring match (case-insensitive) on error message
 *   - status: HTTP status code match
 *   - cooldownMs: fixed cooldown duration
 *   - backoff: true = use exponential backoff (rate limit)
 */
export const ERROR_RULES = [
  // --- Text-based rules (checked first, order = priority) ---
  // Model-scoped overflow: this request can never fit this model but may fit a
  // larger-context combo seat. The account is healthy, so rotating accounts (or
  // locking one) would not help: a combo may try another model, nothing else moves.
  { text: "context_length_exceeded",  scope: SCOPE.model, cooldownMs: 0 },
  { text: "maximum context length",   scope: SCOPE.model, cooldownMs: 0 },
  // Request-scoped: the request itself is at fault, no model/account will accept it.
  { text: "content_policy_violation", scope: SCOPE.request, cooldownMs: 0 },
  { text: "content management policy", scope: SCOPE.request, cooldownMs: 0 },
  { text: "invalid_prompt",           scope: SCOPE.request, cooldownMs: 0 },
  // NVIDIA NIM returns 400 with "degraded" when a specific model cluster is unhealthy.
  // The 15m cooldown lands on the model lock, not the whole API key.
  { provider: "nvidia", text: "degraded", cooldownMs: 15 * 60 * 1000 },
  { text: "no credentials",           cooldownMs: COOLDOWN.long },
  { text: "request not allowed",      cooldownMs: COOLDOWN.short },
  // Kiro 400 for a malformed body: caused by this request, not the credential.
  { text: "improperly formed request", scope: SCOPE.request, cooldownMs: 0 },
  { text: "rate limit",               backoff: true },
  { text: "too many requests",        backoff: true },
  { text: "quota exceeded",           backoff: true },
  { text: "insufficient credit",      backoff: true },
  { text: "credit balance is too low", backoff: true },
  { text: "capacity",                 backoff: true },
  { text: "overloaded",               backoff: true },

  // --- Status-based rules (fallback when text doesn't match) ---
  { status: 401, cooldownMs: COOLDOWN.long },
  { status: 402, cooldownMs: COOLDOWN.long },
  { status: 403, cooldownMs: COOLDOWN.long },
  { status: 404, cooldownMs: COOLDOWN.long },
  // Upstream could not read our request body in time: nothing was processed, so it is a
  // transient transport fault, not a client error. Brief cooldown, then another account.
  { status: 408, cooldownMs: COOLDOWN.short },
  { status: 429, backoff: true },
];

// Backward compat: COOLDOWN_MS object (used by index.js re-export)
export const COOLDOWN_MS = {
  unauthorized: COOLDOWN.long,
  paymentRequired: COOLDOWN.long,
  notFound: COOLDOWN.long,
  transient: TRANSIENT_COOLDOWN_MS,
  requestNotAllowed: COOLDOWN.short,
};
